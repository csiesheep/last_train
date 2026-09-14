// The twenty passengers: one face each, a name in both languages. Solo mode
// lets the human pick a face and gives the bots the rest; a compartment does
// the same across its seats. Faces live at art/face_<id>.jpg.
export const PASSENGERS = [
  { id: "zhou", zh: "周太太", en: "Mrs. Zhou" },
  { id: "lin", zh: "林小姐", en: "Miss Lin" },
  { id: "chen", zh: "陳老闆", en: "Boss Chen" },
  { id: "wang", zh: "王秘書", en: "Secretary Wang" },
  { id: "si", zh: "小四", en: "Xiao Si" },
  { id: "bai", zh: "白老師", en: "Teacher Bai" },
  { id: "jin", zh: "金老先生", en: "Old Mr. Jin" },
  { id: "ivan", zh: "伊凡", en: "Ivan" },
  { id: "natasha", zh: "娜塔莎", en: "Natasha" },
  { id: "margot", zh: "瑪戈", en: "Margot" },
  { id: "smith", zh: "史密斯", en: "Mr. Smith" },
  { id: "singh", zh: "辛格", en: "Singh" },
  { id: "amir", zh: "阿米爾", en: "Amir" },
  { id: "carlos", zh: "卡洛斯", en: "Carlos" },
  { id: "buck", zh: "巴克", en: "Buck" },
  { id: "hana", zh: "花子", en: "Hanako" },
  { id: "mei", zh: "梅姨", en: "Auntie Mei" },
  { id: "fu", zh: "傅先生", en: "Mr. Fu" },
  { id: "rosa", zh: "羅莎", en: "Rosa" },
  { id: "ah_biao", zh: "阿彪", en: "Ah Biao" },
];
export const FACE_IDS = PASSENGERS.map((p) => p.id);
export const PASSENGER_BY_ID = Object.fromEntries(PASSENGERS.map((p) => [p.id, p]));
export const isFace = (id) => Object.prototype.hasOwnProperty.call(PASSENGER_BY_ID, id);
export const passengerName = (id, lang) => (PASSENGER_BY_ID[id] || {})[lang === "zh-Hant" ? "zh" : "en"] || "";
// Faces not yet used at the table, in a shuffled order.
export const freeFaces = (rng, taken, shuffle) => shuffle(rng, FACE_IDS.filter((id) => !taken.includes(id)));
