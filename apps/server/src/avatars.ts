import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError, requireCondition } from './errors.js';

// 头像（R7、R9）：一律重新编码成 256px JPEG，不带任何原图元数据（红线 5）。
export const DEFAULT_AVATAR_URL = '/client/standalone/default-avatar.png';
export const AVATAR_ROUTE = '/media/avatars/';
export const MAX_AVATAR_UPLOAD = 5 * 1024 * 1024;
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_SIZE = 256;
const AVATAR_FILE = /^([0-9a-f-]{36})-([0-9a-f]{32})\.jpg$/;

export interface AvatarOwner { id: string; avatarHash?: string | null; avatarStatus?: string | null }

// 地址带内容哈希：换图就换地址，Cocos 按地址缓存，不会一直显示旧图（R7 AC2）。
export function avatarUrl(owner: AvatarOwner | Record<string, any>): string {
  return owner.avatarStatus === 'active' && owner.avatarHash ? `${AVATAR_ROUTE}${owner.id}-${owner.avatarHash}.jpg` : DEFAULT_AVATAR_URL;
}

// 原版客户端：sex 为真播女声，否则男声。库里 1=男、2=女、0=没设。
export const wireSex = (sex: number | null | undefined) => sex === 2 ? 1 : 0;

export function parseAvatarFile(file: string): { accountId: string; hash: string } | null {
  const match = AVATAR_FILE.exec(file);
  return match ? { accountId: match[1]!, hash: match[2]! } : null;
}

export async function normalizeAvatar(input: Buffer): Promise<{ bytes: Buffer; hash: string }> {
  requireCondition(input.length > 0, 'AVATAR_NOT_IMAGE', '请选择一张图片。');
  requireCondition(input.length <= MAX_AVATAR_UPLOAD, 'AVATAR_TOO_LARGE', '图片太大了，请换一张 5MB 以内的。', 413);
  let bytes: Buffer;
  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 });
    const { format } = await image.metadata();
    requireCondition(format === 'jpeg' || format === 'png' || format === 'webp', 'AVATAR_NOT_IMAGE', '只支持 JPG、PNG、WebP 图片。');
    // rotate() 先按拍摄方向转正；sharp 默认不写回任何元数据（拍摄位置、机型都丢掉）。
    bytes = await image.rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('AVATAR_NOT_IMAGE', '这个文件不是能用的图片，请换一张。');
  }
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex').slice(0, 32) };
}
