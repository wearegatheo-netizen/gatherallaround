// /wp/<프로젝트 id> — 와펜 프로젝트 공유 링크 (OG + 즉시 /wappen/#/project/<id> 로 이동). 본체는 wappen/share-page.js
import { handleShare } from '../../wappen/share-page.js';
export const onRequest = (context) => handleShare(context, 'project');
