const adjectives = [
  "神秘的", "快乐的", "勇敢的", "温柔的", "调皮的",
  "可爱的", "酷酷的", "优雅的", "活泼的", "安静的",
  "帅气的", "漂亮的", "机灵的", "憨厚的", "灵巧的",
  "热情的", "淡定的", "霸气的", "萌萌的", "高冷的",
  "善良的", "洒脱的", "搞怪的", "聪明的", "傲娇的",
  "佛系的", "认真的", "浪漫的", "文艺的", "热血的",
  "懒懒的", "霸道的",
];

const animals = [
  "熊猫", "兔子", "老虎", "猫咪", "狗狗",
  "狐狸", "松鼠", "企鹅", "海豚", "鹦鹉",
  "考拉", "浣熊", "海獭", "刺猬", "鲸鱼",
  "长颈鹿", "斑马", "孔雀", "天鹅", "仙鹤",
  "水獭", "袋鼠", "树懒", "猫头鹰", "火烈鸟",
  "小鹿", "海马", "水母", "鹦鹉鱼", "小蜜蜂",
  "仓鼠", "龙猫",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export function generateAnonymousNickname(profileId: string, menuItemId: string): string {
  const hash = hashString(`${profileId}:${menuItemId}`);
  const adjIndex = hash % adjectives.length;
  const animalIndex = (hash >> 8) % animals.length;
  return `${adjectives[adjIndex]}${animals[animalIndex]}`;
}
