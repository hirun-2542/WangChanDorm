export function flexStrings(message: unknown): string[] {
  const found: string[] = [];

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }

      return;
    }

    if (typeof node !== "object" || node === null) {
      return;
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if ((key === "text" || key === "altText") && typeof value === "string") {
        found.push(value);
      } else {
        walk(value);
      }
    }
  }

  walk(message);

  return found;
}

export function flexText(message: unknown): string {
  return flexStrings(message).join(" ");
}
