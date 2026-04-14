import { db } from "./db";
import { Tag, MenuItem, ComboTemplate } from "./types";

const defaultTags: Omit<Tag, "id" | "createdAt">[] = [
  { name: "本帮菜", type: "cuisine" },
  { name: "杭帮菜", type: "cuisine" },
  { name: "川菜", type: "cuisine" },
  { name: "港式", type: "cuisine" },
  { name: "东北菜", type: "cuisine" },
  { name: "荤菜", type: "category" },
  { name: "素菜", type: "category" },
  { name: "主食", type: "category" },
  { name: "汤", type: "category" },
  { name: "小吃", type: "category" },
  { name: "饮料", type: "category" },
  { name: "甜品", type: "category" },
];

const defaultMenuItems: Omit<MenuItem, "id" | "createdAt" | "updatedAt">[] = [
  {
    kind: "recipe",
    name: "番茄炒蛋",
    tags: [],
    ingredients: [
      { name: "番茄", amount: "2个" },
      { name: "鸡蛋", amount: "3个" },
      { name: "葱花", amount: "少许" },
    ],
    steps: [
      { order: 1, description: "番茄切块，鸡蛋打散备用" },
      { order: 2, description: "热锅凉油，倒入蛋液炒熟盛出" },
      { order: 3, description: "再加油炒番茄出汁，倒入鸡蛋炒匀，撒葱花出锅" },
    ],
    tips: "番茄选熟透的更容易出汁",
  },
  {
    kind: "takeout",
    name: "香辣鸡腿堡",
    tags: [],
    shop: "肯德基",
  },
  {
    kind: "recipe",
    name: "红烧肉",
    tags: [],
    ingredients: [
      { name: "五花肉", amount: "500g" },
      { name: "冰糖", amount: "30g" },
      { name: "生抽", amount: "2勺" },
      { name: "老抽", amount: "1勺" },
    ],
    steps: [
      { order: 1, description: "五花肉切块焯水备用" },
      { order: 2, description: "锅中少油炒糖色，下肉块翻炒上色" },
      { order: 3, description: "加入调料和开水，小火炖煮45分钟即可" },
    ],
  },
];

function makeTagId(name: string) {
  return `seed-tag-${name}`;
}
function makeMenuItemId(kind: string, name: string) {
  return `seed-item-${kind}-${name}`;
}
function makeTemplateId(name: string) {
  return `seed-template-${name}`;
}

export async function seedDatabase() {
  const tagCount = await db.tags.count();
  if (tagCount === 0) {
    const tagsToAdd: Tag[] = defaultTags.map((t) => ({
      ...t,
      id: makeTagId(t.name),
      createdAt: Date.now(),
      syncStatus: "local",
      version: 1,
    }));
    await db.tags.bulkAdd(tagsToAdd);

    // 绑定示例标签
    const cuisineTags = tagsToAdd.filter((t) => t.type === "cuisine");
    const categoryTags = tagsToAdd.filter((t) => t.type === "category");

    const tagMap: Record<string, string[]> = {
      番茄炒蛋: [cuisineTags.find((t) => t.name === "本帮菜")!.id, categoryTags.find((t) => t.name === "素菜")!.id],
      香辣鸡腿堡: [categoryTags.find((t) => t.name === "小吃")!.id],
      红烧肉: [cuisineTags.find((t) => t.name === "本帮菜")!.id, categoryTags.find((t) => t.name === "荤菜")!.id],
    };

    const menuItemsToAdd: MenuItem[] = defaultMenuItems.map((m) => ({
      ...m,
      id: makeMenuItemId(m.kind, m.name),
      tags: tagMap[m.name] || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncStatus: "local",
      version: 1,
    }));
    await db.menuItems.bulkAdd(menuItemsToAdd);

    const stapleTag = categoryTags.find((t) => t.name === "主食")!;
    const meatTag = categoryTags.find((t) => t.name === "荤菜")!;
    const vegTag = categoryTags.find((t) => t.name === "素菜")!;
    const soupTag = categoryTags.find((t) => t.name === "汤")!;
    const snackTag = categoryTags.find((t) => t.name === "小吃")!;
    const drinkTag = categoryTags.find((t) => t.name === "饮料")!;
    const dessertTag = categoryTags.find((t) => t.name === "甜品")!;

    const defaultTemplates: Omit<ComboTemplate, "id" | "createdAt">[] = [
      {
        name: "1主食 + 1荤菜 + 1素菜",
        isBuiltin: true,
        rules: [
          { count: 1, tagIds: [stapleTag.id] },
          { count: 1, tagIds: [meatTag.id] },
          { count: 1, tagIds: [vegTag.id] },
        ],
      },
      {
        name: "1汤 + 1主食",
        isBuiltin: true,
        rules: [
          { count: 1, tagIds: [soupTag.id] },
          { count: 1, tagIds: [stapleTag.id] },
        ],
      },
      {
        name: "2小吃 + 1饮料",
        isBuiltin: true,
        rules: [
          { count: 2, tagIds: [snackTag.id] },
          { count: 1, tagIds: [drinkTag.id] },
        ],
      },
      {
        name: "1荤菜 + 1素菜",
        isBuiltin: true,
        rules: [
          { count: 1, tagIds: [meatTag.id] },
          { count: 1, tagIds: [vegTag.id] },
        ],
      },
      {
        name: "1主食 + 1汤 + 1甜品",
        isBuiltin: true,
        rules: [
          { count: 1, tagIds: [stapleTag.id] },
          { count: 1, tagIds: [soupTag.id] },
          { count: 1, tagIds: [dessertTag.id] },
        ],
      },
    ];

    const templatesToAdd: ComboTemplate[] = defaultTemplates.map((t) => ({
      ...t,
      id: makeTemplateId(t.name),
      createdAt: Date.now(),
      syncStatus: "local",
      version: 1,
    }));
    await db.comboTemplates.bulkAdd(templatesToAdd);
  }
}
