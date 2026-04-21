export function isDataUrlImage(value: string | undefined | null): value is string {
  return typeof value === "string" && value.startsWith("data:image/");
}
