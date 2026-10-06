// /ww/<작품 id> — 와펜 작품 공유 링크 (OG + 즉시 /wappen/#/work/<id> 로 이동). 본체는 wappen/share-page.js
import { handleShare } from '../../wappen/share-page.js';
export const onRequest = (context) => handleShare(context, 'work');
