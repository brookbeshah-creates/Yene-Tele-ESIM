import crypto from 'node:crypto';

export interface EncryptedSecretBlob {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface EsimActivationSecretPayload {
  smdpAddress: string;
  activationCode: string;
  lpaUri: string;
  qrPayload: string;
}

export function encryptActivationPayload(
  payload: EsimActivationSecretPayload,
  key: Buffer,
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob: EncryptedSecretBlob = {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
  return JSON.stringify(blob);
}

export function decryptActivationPayload(
  encodedBlob: string,
  key: Buffer,
): EsimActivationSecretPayload {
  const blob = JSON.parse(encodedBlob) as EncryptedSecretBlob;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(blob.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString('utf8')) as EsimActivationSecretPayload;
}
