// 家人端人話狀態（規格 6.3）與可複製的 LINE 文字（規格 9.1）。家人端不出現內部狀態名詞。
export type ItemForMessage = {
  status: string;
  batch_status: string | null;
  reject_reason: string | null;
  family_confirm_needed_reason?: string | null;
  quantity?: number | null;
  qty_bought?: number | null;
  purchase_result?: string | null;
  purchase_reason?: string | null;
};

export function humanStatus(i: ItemForMessage): string {
  switch (i.status) {
    case 'draft':
      return '草稿，還沒送出';
    case 'pending_admin':
      return '等 Grant 核對中';
    case 'rejected':
      return `Grant 請你修改一下：${i.reject_reason ?? '請看備註'}`;
    case 'pending_family':
      return `價格或規格有變動，請你再確認一次${i.family_confirm_needed_reason ? `（${i.family_confirm_needed_reason}）` : ''}`;
    case 'confirmed':
      return 'Grant 已確認，等待下單';
    case 'not_bought':
      return `這件沒買到：${i.purchase_reason ?? '缺貨'}`;
    case 'ordered': {
      if (i.purchase_result === 'partial' && i.quantity && i.qty_bought !== null && i.qty_bought !== undefined)
        return `${i.qty_bought} 件已買、${i.quantity - i.qty_bought} 件缺貨`;
      if (i.batch_status === 'arrived' || i.batch_status === 'settled') return '到貨了，請領取';
      if (i.batch_status === 'shipping') return '已訂購，運送中';
      return '已訂購';
    }
    default:
      return '處理中';
  }
}

export function batchClosedText(name: string, personName: string, count: number): string {
  return `${personName}，「${name}」截止了，你送了 ${count} 項，等 Grant 核對。`;
}

export function confirmSummaryText(personName: string, confirmed: number, needYou: number, rejected: number): string {
  const parts = [`${confirmed} 項 Grant 已確認`];
  if (needYou) parts.push(`${needYou} 項需要你再確認`);
  if (rejected) parts.push(`${rejected} 項請你修改`);
  return `${personName}，目前進度：${parts.join('、')}。請進站看看。`;
}

export function inviteText(personName: string, url: string, reissue: boolean): string {
  return reissue
    ? `${personName}，這是新的進站連結，舊的不能用了，點這個進去就好，之前送出的清單都還在：\n${url}`
    : `${personName}，這是你專屬的合購網站連結，點進去就能挑東西、送清單（請不要轉給別人）：\n${url}`;
}
