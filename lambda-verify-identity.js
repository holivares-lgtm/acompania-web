/**
 * ACOMPAÑÍA — Verificación de Identidad
 * AWS Lambda: Node.js 20.x
 *
 * Orquesta:
 *  1. Textract AnalyzeID  → extrae datos del carnet (RUT, nombre, fecha)
 *  2. Rekognition CompareFaces → compara foto carnet vs selfie
 *  3. Rekognition DetectFaces  → valida calidad y pose del selfie
 *
 * Endpoints (API Gateway):
 *  POST /verify/start          → crea sesión, retorna sessionId + presigned URLs S3
 *  POST /verify/submit         → recibe sessionId, dispara análisis
 *  GET  /verify/status/:id     → retorna resultado de la verificación
 *
 * Variables de entorno requeridas:
 *  S3_BUCKET_UPLOADS           → bucket donde se suben las imágenes temporales
 *  DYNAMODB_TABLE              → tabla donde se guardan sesiones y resultados
 *  REKOGNITION_CONFIDENCE_MIN  → umbral mínimo de similitud facial (default: 90)
 *  ALLOWED_ORIGINS             → CORS origins permitidos
 */

'use strict';

const {
  TextractClient,
  AnalyzeIDCommand,
} = require('@aws-sdk/client-textract');

const {
  RekognitionClient,
  CompareFacesCommand,
  DetectFacesCommand,
} = require('@aws-sdk/client-rekognition');

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');

const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { randomUUID } = require('crypto');

// ── Clientes AWS (reutilizados entre invocaciones) ──
const textract   = new TextractClient({ region: process.env.AWS_REGION || 'us-east-1' });
const rekognition = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3         = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamo     = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

const BUCKET         = process.env.S3_BUCKET_UPLOADS;
const TABLE          = process.env.DYNAMODB_TABLE;
const CONF_MIN       = parseFloat(process.env.REKOGNITION_CONFIDENCE_MIN || '90');
const SESSION_TTL_S  = 30 * 60; // 30 minutos
const UPLOAD_URL_TTL = 10 * 60; // 10 minutos para subir

// ── CORS headers ──
const corsHeaders = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGINS || '*',
  'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key',
};

// ═══════════════════════════════════════════════════════════
//  ROUTER PRINCIPAL
// ═══════════════════════════════════════════════════════════
exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const path   = event.path || event.rawPath || '';
  const method = event.httpMethod || event.requestContext?.http?.method || 'POST';

  try {
    if (method === 'POST' && path.endsWith('/verify/start')) {
      return await handleStart(event);
    }
    if (method === 'POST' && path.endsWith('/verify/submit')) {
      return await handleSubmit(event);
    }
    if (method === 'GET' && path.includes('/verify/status/')) {
      const sessionId = path.split('/verify/status/')[1];
      return await handleStatus(sessionId);
    }
    return response(404, { error: 'Route not found' });
  } catch (err) {
    console.error('Unhandled error:', err);
    return response(500, { error: 'Internal server error', detail: err.message });
  }
};

// ═══════════════════════════════════════════════════════════
//  STEP 1: Crear sesión + presigned URLs para subir imágenes
// ═══════════════════════════════════════════════════════════
async function handleStart(event) {
  const body   = JSON.parse(event.body || '{}');
  const userId = body.userId;         // ID del usuario en la app
  const role   = body.role || 'user'; // 'cliente' | 'acompanante'

  if (!userId) {
    return response(400, { error: 'userId requerido' });
  }

  const sessionId = randomUUID();
  const now       = Math.floor(Date.now() / 1000);
  const prefix    = `verify/${sessionId}`;

  // Generar 3 presigned URLs: frente carnet, reverso carnet, selfie
  const keys = {
    cardFront: `${prefix}/card-front.jpg`,
    cardBack:  `${prefix}/card-back.jpg`,
    selfie:    `${prefix}/selfie.jpg`,
  };

  const [urlFront, urlBack, urlSelfie] = await Promise.all([
    getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET, Key: keys.cardFront,
      ContentType: 'image/jpeg',
      Metadata: { sessionId, userId, imageType: 'card-front' },
    }), { expiresIn: UPLOAD_URL_TTL }),

    getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET, Key: keys.cardBack,
      ContentType: 'image/jpeg',
      Metadata: { sessionId, userId, imageType: 'card-back' },
    }), { expiresIn: UPLOAD_URL_TTL }),

    getSignedUrl(s3, new PutObjectCommand({
      Bucket: BUCKET, Key: keys.selfie,
      ContentType: 'image/jpeg',
      Metadata: { sessionId, userId, imageType: 'selfie' },
    }), { expiresIn: UPLOAD_URL_TTL }),
  ]);

  // Guardar sesión en DynamoDB
  await dynamo.send(new PutItemCommand({
    TableName: TABLE,
    Item: marshall({
      pk:        `SESSION#${sessionId}`,
      sk:        'METADATA',
      sessionId,
      userId,
      role,
      status:    'PENDING_UPLOAD',
      s3Keys:    keys,
      createdAt: now,
      expiresAt: now + SESSION_TTL_S, // TTL para DynamoDB
    }),
  }));

  return response(200, {
    sessionId,
    uploadUrls: {
      cardFront: urlFront,
      cardBack:  urlBack,
      selfie:    urlSelfie,
    },
    instructions: {
      cardFront: 'Foto nítida de la parte frontal de tu cédula de identidad chilena',
      cardBack:  'Foto nítida de la parte trasera de tu cédula de identidad',
      selfie:    'Selfie con rostro visible, buena iluminación, ojos abiertos mirando a cámara',
    },
    expiresInSeconds: UPLOAD_URL_TTL,
  });
}

// ═══════════════════════════════════════════════════════════
//  STEP 2: Analizar imágenes con Textract + Rekognition
// ═══════════════════════════════════════════════════════════
async function handleSubmit(event) {
  const body      = JSON.parse(event.body || '{}');
  const sessionId = body.sessionId;

  if (!sessionId) {
    return response(400, { error: 'sessionId requerido' });
  }

  // Recuperar sesión de DynamoDB
  const sessionRes = await dynamo.send(new GetItemCommand({
    TableName: TABLE,
    Key: marshall({ pk: `SESSION#${sessionId}`, sk: 'METADATA' }),
  }));

  if (!sessionRes.Item) {
    return response(404, { error: 'Sesión no encontrada o expirada' });
  }

  const session = unmarshall(sessionRes.Item);

  if (session.status !== 'PENDING_UPLOAD') {
    return response(409, { error: `Sesión en estado inválido: ${session.status}` });
  }

  // Marcar como procesando
  await updateSessionStatus(sessionId, 'PROCESSING');

  // Ejecutar análisis en paralelo donde sea posible
  let textractResult, compareFacesResult, detectFacesResult;
  let analysisErrors = [];

  // ── TEXTRACT: Extraer datos del carnet (AnalyzeID) ──
  try {
    textractResult = await runTextractAnalyzeID(session.s3Keys);
  } catch (err) {
    console.error('Textract error:', err);
    analysisErrors.push({ service: 'textract', error: err.message });
  }

  // ── REKOGNITION: Comparar cara del carnet con selfie ──
  try {
    [compareFacesResult, detectFacesResult] = await Promise.all([
      runCompareFaces(session.s3Keys),
      runDetectFaces(session.s3Keys.selfie),
    ]);
  } catch (err) {
    console.error('Rekognition error:', err);
    analysisErrors.push({ service: 'rekognition', error: err.message });
  }

  // ── Evaluar resultados ──
  const evaluation = evaluateVerification({
    textract: textractResult,
    compareFaces: compareFacesResult,
    detectFaces: detectFacesResult,
    errors: analysisErrors,
  });

  // Guardar resultado completo
  const resultItem = {
    pk:         `SESSION#${sessionId}`,
    sk:         'RESULT',
    sessionId,
    userId:     session.userId,
    status:     evaluation.approved ? 'APPROVED' : 'REJECTED',
    score:      evaluation.score,
    reasons:    evaluation.reasons,
    extractedData: evaluation.extractedData || null,
    faceSimilarity: compareFacesResult?.similarity || null,
    livenessScore:  detectFacesResult?.quality || null,
    analysisErrors,
    completedAt: Math.floor(Date.now() / 1000),
    expiresAt:   Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 días
  };

  await Promise.all([
    dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: marshall(resultItem),
    })),
    updateSessionStatus(sessionId, evaluation.approved ? 'APPROVED' : 'REJECTED'),
    // Limpiar imágenes de S3 después de analizar (privacidad)
    cleanupS3Images(sessionId, session.s3Keys),
  ]);

  return response(200, {
    sessionId,
    status: evaluation.approved ? 'APPROVED' : 'REJECTED',
    score:  evaluation.score,
    reasons: evaluation.reasons,
    extractedData: evaluation.approved ? evaluation.extractedData : null,
  });
}

// ═══════════════════════════════════════════════════════════
//  STEP 3: Consultar estado de sesión
// ═══════════════════════════════════════════════════════════
async function handleStatus(sessionId) {
  if (!sessionId) {
    return response(400, { error: 'sessionId requerido' });
  }

  const [sessionRes, resultRes] = await Promise.all([
    dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: marshall({ pk: `SESSION#${sessionId}`, sk: 'METADATA' }),
    })),
    dynamo.send(new GetItemCommand({
      TableName: TABLE,
      Key: marshall({ pk: `SESSION#${sessionId}`, sk: 'RESULT' }),
    })),
  ]);

  if (!sessionRes.Item) {
    return response(404, { error: 'Sesión no encontrada' });
  }

  const session = unmarshall(sessionRes.Item);
  const result  = resultRes.Item ? unmarshall(resultRes.Item) : null;

  return response(200, {
    sessionId,
    status:      session.status,
    createdAt:   session.createdAt,
    completedAt: result?.completedAt || null,
    approved:    result?.status === 'APPROVED' || false,
    score:       result?.score || null,
    reasons:     result?.reasons || [],
    // Solo devolver datos extraídos si está aprobado
    extractedData: result?.status === 'APPROVED' ? result.extractedData : null,
  });
}

// ═══════════════════════════════════════════════════════════
//  AWS TEXTRACT: AnalyzeID — extrae datos del carnet
// ═══════════════════════════════════════════════════════════
async function runTextractAnalyzeID({ cardFront, cardBack }) {
  /**
   * Textract AnalyzeID puede procesar hasta 2 páginas del mismo documento.
   * Para la cédula chilena extrae: nombre, fecha nacimiento, número documento (RUN/RUT).
   *
   * NOTA: AnalyzeID está optimizado para:
   *   - Pasaportes (ICAO standard)
   *   - Licencias de conducir de EEUU
   *   - Para cédulas de otros países usa DetectDocumentText como fallback.
   */

  let result = {
    documentType: null,
    firstName:    null,
    lastName:     null,
    documentNumber: null,
    dateOfBirth:  null,
    expiryDate:   null,
    confidence:   0,
    rawFields:    {},
  };

  try {
    // Intentar con AnalyzeID (funciona bien con cédula chilena desde 2023)
    const command = new AnalyzeIDCommand({
      DocumentPages: [
        { S3Object: { Bucket: BUCKET, Name: cardFront } },
        { S3Object: { Bucket: BUCKET, Name: cardBack } },
      ],
    });

    const textractResponse = await textract.send(command);

    for (const doc of (textractResponse.IdentityDocuments || [])) {
      for (const field of (doc.IdentityDocumentFields || [])) {
        const type  = field.Type?.Text;
        const value = field.ValueDetection?.Text;
        const conf  = field.ValueDetection?.Confidence || 0;

        if (!type || !value) continue;

        result.rawFields[type] = { value, confidence: conf };

        // Mapear campos estándar
        switch (type) {
          case 'FIRST_NAME':      result.firstName    = value; break;
          case 'LAST_NAME':       result.lastName     = value; break;
          case 'DOCUMENT_NUMBER': result.documentNumber = value; break;
          case 'DATE_OF_BIRTH':   result.dateOfBirth  = value; break;
          case 'EXPIRATION_DATE': result.expiryDate   = value; break;
          case 'ID_TYPE':         result.documentType = value; break;
        }

        result.confidence = Math.max(result.confidence, conf);
      }
    }
  } catch (analyzeError) {
    // Fallback: DetectDocumentText para texto libre
    console.warn('AnalyzeID failed, falling back to DetectDocumentText:', analyzeError.message);
    const fallback = await runTextractFallback(cardFront);
    result = { ...result, ...fallback, fallbackUsed: true };
  }

  return result;
}

// Fallback con DetectDocumentText para cédulas que AnalyzeID no reconoce bien
async function runTextractFallback(s3Key) {
  const { DetectDocumentTextCommand } = require('@aws-sdk/client-textract');

  const cmd = new DetectDocumentTextCommand({
    Document: { S3Object: { Bucket: BUCKET, Name: s3Key } },
  });

  const res = await textract.send(cmd);
  const lines = res.Blocks
    .filter(b => b.BlockType === 'LINE')
    .map(b => ({ text: b.Text, confidence: b.Confidence }));

  // Extraer RUT chileno con regex (formato: 12.345.678-9)
  const rutRegex = /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g;
  const allText  = lines.map(l => l.text).join(' ');
  const ruts     = allText.match(rutRegex);

  return {
    rawText: lines,
    documentNumber: ruts?.[0]?.replace(/\./g, '') || null,
    confidence: Math.max(...lines.map(l => l.confidence || 0)),
  };
}

// ═══════════════════════════════════════════════════════════
//  AWS REKOGNITION: CompareFaces — carnet foto vs selfie
// ═══════════════════════════════════════════════════════════
async function runCompareFaces(s3Keys) {
  /**
   * CompareFaces compara una cara fuente (foto del carnet) con una cara objetivo (selfie).
   * Retorna FaceMatches con SimilarityThreshold.
   * Umbral recomendado: 90% para verificación de identidad de alta seguridad.
   */

  const command = new CompareFacesCommand({
    SourceImage: {
      S3Object: { Bucket: BUCKET, Name: s3Keys.cardFront },
    },
    TargetImage: {
      S3Object: { Bucket: BUCKET, Name: s3Keys.selfie },
    },
    SimilarityThreshold: CONF_MIN,
    QualityFilter: 'HIGH', // Filtra imágenes de baja calidad automáticamente
  });

  const res = await rekognition.send(command);

  const matches    = res.FaceMatches || [];
  const unmatched  = res.UnmatchedFaces || [];
  const topMatch   = matches.length > 0
    ? matches.sort((a, b) => b.Similarity - a.Similarity)[0]
    : null;

  return {
    matched:    topMatch !== null,
    similarity: topMatch?.Similarity || 0,
    confidence: topMatch?.Face?.Confidence || 0,
    faceCount:  matches.length + unmatched.length,
    unmatchedCount: unmatched.length,
    boundingBox: topMatch?.Face?.BoundingBox || null,
  };
}

// ═══════════════════════════════════════════════════════════
//  AWS REKOGNITION: DetectFaces — calidad y liveness del selfie
// ═══════════════════════════════════════════════════════════
async function runDetectFaces(selfieKey) {
  /**
   * DetectFaces con Attributes=ALL retorna:
   *  - Pose (yaw, pitch, roll) → detecta si mira de frente
   *  - Quality (brightness, sharpness)
   *  - EyesOpen, MouthOpen (liveness básico)
   *  - AgeRange
   *
   * NOTA: Para liveness detection avanzado usar rekognition:StartFaceLivenessSession
   * que requiere integración con el SDK de amplify en el frontend ($0.01/sesión).
   */

  const command = new DetectFacesCommand({
    Image: {
      S3Object: { Bucket: BUCKET, Name: selfieKey },
    },
    Attributes: ['ALL'],
  });

  const res = await rekognition.send(command);
  const faces = res.FaceDetails || [];

  if (faces.length === 0) {
    return {
      faceDetected: false,
      quality: 0,
      poseOk: false,
      eyesOpen: false,
      ageRange: null,
      issues: ['No se detectó ningún rostro en la selfie'],
    };
  }

  if (faces.length > 1) {
    return {
      faceDetected: true,
      multipleFaces: true,
      quality: 0,
      poseOk: false,
      eyesOpen: false,
      issues: ['Se detectaron múltiples rostros. Solo debe aparecer una persona.'],
    };
  }

  const face = faces[0];
  const pose = face.Pose || {};
  const qual = face.Quality || {};

  // Validar pose: el usuario debe mirar de frente
  const poseOk = (
    Math.abs(pose.Yaw   || 0) < 25 && // No girado horizontalmente más de 25°
    Math.abs(pose.Pitch || 0) < 20 && // No inclinado más de 20°
    Math.abs(pose.Roll  || 0) < 25    // No rotado más de 25°
  );

  const eyesOpen      = (face.EyesOpen?.Value === true && (face.EyesOpen?.Confidence || 0) > 80);
  const brightnessOk  = (qual.Brightness || 0) > 30;
  const sharpnessOk   = (qual.Sharpness  || 0) > 30;

  const issues = [];
  if (!poseOk)       issues.push('El rostro no está de frente a la cámara');
  if (!eyesOpen)     issues.push('Los ojos deben estar abiertos y visibles');
  if (!brightnessOk) issues.push('La imagen está muy oscura');
  if (!sharpnessOk)  issues.push('La imagen está desenfocada');

  // Score de calidad compuesto (0-100)
  const qualityScore = Math.round(
    ((qual.Brightness || 0) + (qual.Sharpness || 0)) / 2
  );

  return {
    faceDetected:  true,
    confidence:    face.Confidence || 0,
    poseOk,
    eyesOpen,
    brightnessOk,
    sharpnessOk,
    quality:       qualityScore,
    ageRange:      face.AgeRange ? `${face.AgeRange.Low}-${face.AgeRange.High}` : null,
    pose: {
      yaw:   pose.Yaw,
      pitch: pose.Pitch,
      roll:  pose.Roll,
    },
    issues,
  };
}

// ═══════════════════════════════════════════════════════════
//  EVALUACIÓN: Combina resultados y decide aprobación
// ═══════════════════════════════════════════════════════════
function evaluateVerification({ textract, compareFaces, detectFaces, errors }) {
  const reasons   = [];
  let score       = 0;
  let approved    = true;

  // ── Verificar Textract ──
  if (!textract) {
    reasons.push({ code: 'TEXTRACT_FAILED', msg: 'No se pudo leer el documento de identidad' });
    approved = false;
  } else {
    if (!textract.documentNumber) {
      reasons.push({ code: 'NO_DOCUMENT_NUMBER', msg: 'No se detectó número de documento (RUT)' });
      approved = false;
    } else {
      score += 25;
    }
    if (!textract.dateOfBirth) {
      reasons.push({ code: 'NO_DOB', msg: 'No se detectó fecha de nacimiento' });
    } else {
      // Verificar mayoría de edad
      const dob      = parseDate(textract.dateOfBirth);
      const ageYears = dob ? (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000) : null;
      if (ageYears !== null && ageYears < 18) {
        reasons.push({ code: 'UNDERAGE', msg: 'El usuario es menor de edad' });
        approved = false;
      } else {
        score += 15;
      }
    }
    if (textract.confidence > 70) score += 10;
  }

  // ── Verificar CompareFaces ──
  if (!compareFaces) {
    reasons.push({ code: 'COMPARE_FAILED', msg: 'No se pudo comparar el rostro con el documento' });
    approved = false;
  } else if (!compareFaces.matched) {
    reasons.push({
      code: 'FACE_MISMATCH',
      msg: `El rostro no coincide con la foto del documento (similitud: ${(compareFaces.similarity || 0).toFixed(1)}%)`
    });
    approved = false;
  } else {
    const sim = compareFaces.similarity;
    if (sim >= 99)       score += 40;
    else if (sim >= 95)  score += 35;
    else if (sim >= 90)  score += 28;
    else                 score += 15;
    reasons.push({
      code: 'FACE_MATCH',
      msg: `Coincidencia facial: ${sim.toFixed(1)}%`
    });
  }

  // ── Verificar DetectFaces (calidad selfie) ──
  if (!detectFaces) {
    reasons.push({ code: 'DETECT_FAILED', msg: 'No se pudo analizar la selfie' });
    approved = false;
  } else if (!detectFaces.faceDetected) {
    reasons.push({ code: 'NO_FACE', msg: 'No se detectó ningún rostro en la selfie' });
    approved = false;
  } else if (detectFaces.multipleFaces) {
    reasons.push({ code: 'MULTIPLE_FACES', msg: 'La selfie contiene más de un rostro' });
    approved = false;
  } else {
    if (detectFaces.poseOk)   score += 5;
    if (detectFaces.eyesOpen) score += 3;
    if (detectFaces.quality > 50) score += 2;

    // Agregar issues de calidad como advertencias (no bloquean si el resto es OK)
    if (detectFaces.issues?.length > 0) {
      detectFaces.issues.forEach(issue =>
        reasons.push({ code: 'QUALITY_WARNING', msg: issue })
      );
      // Solo bloquear si hay problemas graves de calidad
      if (!detectFaces.poseOk && !detectFaces.eyesOpen) {
        approved = false;
      }
    }
  }

  // Si hay errores de servicios AWS, marcar como revisión manual
  if (errors?.length > 0) {
    reasons.push({ code: 'MANUAL_REVIEW_REQUIRED', msg: 'Algunos servicios fallaron — requiere revisión manual' });
    // No bloquear automáticamente si el error es parcial
  }

  return {
    approved,
    score: Math.min(score, 100),
    reasons,
    extractedData: textract ? {
      firstName:      textract.firstName,
      lastName:       textract.lastName,
      documentNumber: textract.documentNumber,
      dateOfBirth:    textract.dateOfBirth,
      documentType:   textract.documentType,
    } : null,
  };
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

async function updateSessionStatus(sessionId, status) {
  return dynamo.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({ pk: `SESSION#${sessionId}`, sk: 'METADATA' }),
    UpdateExpression: 'SET #st = :s, updatedAt = :t',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: marshall({
      ':s': status,
      ':t': Math.floor(Date.now() / 1000),
    }),
  }));
}

async function cleanupS3Images(sessionId, keys) {
  /**
   * Eliminar imágenes de S3 inmediatamente después del análisis.
   * La política de privacidad exige no retener biometría.
   */
  try {
    await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: {
        Objects: Object.values(keys).map(Key => ({ Key })),
        Quiet: true,
      },
    }));
    console.log(`Cleaned up ${Object.keys(keys).length} images for session ${sessionId}`);
  } catch (err) {
    // No fallar la verificación si la limpieza falla — el TTL del bucket se encargará
    console.error('S3 cleanup error (non-critical):', err.message);
  }
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Formatos comunes en cédulas: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
  const formats = [
    /(\d{2})\/(\d{2})\/(\d{4})/,  // DD/MM/YYYY
    /(\d{4})-(\d{2})-(\d{2})/,    // YYYY-MM-DD
    /(\d{2})-(\d{2})-(\d{4})/,    // DD-MM-YYYY
  ];
  for (const fmt of formats) {
    const m = dateStr.match(fmt);
    if (m) {
      const [, a, b, c] = m;
      // Intentar como DD/MM/YYYY primero (más común en Chile)
      const d = new Date(`${c}-${b}-${a}`);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}
