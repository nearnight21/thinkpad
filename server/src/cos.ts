import { createRequire } from 'node:module';

interface CosClient {
  getObjectUrl(options: Record<string, unknown>): string;
  putObject(
    options: Record<string, unknown>,
    callback: (error: Error | null) => void,
  ): void;
}

interface CosConstructor {
  new (options: { SecretId: string; SecretKey: string }): CosClient;
}

export interface ThinkPadCosOptions {
  bucket: string;
  region: string;
  secretId: string;
  secretKey: string;
}

export class ThinkPadCos {
  private readonly client: CosClient;

  constructor(private readonly options: ThinkPadCosOptions) {
    const require = createRequire(import.meta.url);
    const Cos = require('cos-nodejs-sdk-v5') as CosConstructor;
    this.client = new Cos({ SecretId: options.secretId, SecretKey: options.secretKey });
  }

  signedUrl(key: string, method: 'GET' | 'PUT', expires = 300): string {
    const result = this.client.getObjectUrl({
      Bucket: this.options.bucket,
      Region: this.options.region,
      Key: key,
      Method: method,
      Sign: true,
      Expires: expires,
      Protocol: 'https:',
    });
    const parsed = new URL(result);
    if (parsed.protocol !== 'https:') throw new Error('COS 返回了非 HTTPS 地址。');
    return parsed.toString();
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.client.putObject({
        Bucket: this.options.bucket,
        Region: this.options.region,
        Key: key,
        Body: body,
        ContentType: contentType,
      }, (error) => error ? reject(error) : resolve());
    });
  }
}
