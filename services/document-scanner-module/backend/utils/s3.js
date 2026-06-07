import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const forcePathStyle = String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true';

export const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle,
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export async function uploadToS3({ key, body, contentType }) {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) throw new Error('AWS_S3_BUCKET is required.');

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || 'AES256',
    })
  );

  const baseUrl = process.env.S3_PUBLIC_BASE_URL || `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`;

  return {
    key,
    url: `${baseUrl}/${key}`,
  };
}

export async function deleteFromS3(key) {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket || !key) return;

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

