import { registerPlugin } from "@capacitor/core";
import { parseLabel, toLines, type LabelValues, type TextPiece } from "./labelParse";

// The app's own iOS plugin (ios/App/App/LabelReader.swift): takes or picks a photo and reads its text on the phone.
const LabelReader = registerPlugin<{ read(): Promise<{ pieces: TextPiece[] }> }>("LabelReader");

export type LabelScan = { values: LabelValues } | { error: "cancelled" | "camera-denied" | "unreadable" };

export async function scanNutritionLabel(): Promise<LabelScan> {
  try {
    const { pieces } = await LabelReader.read();
    return { values: parseLabel(toLines(pieces)) };
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { error: code === "cancelled" || code === "camera-denied" ? code : "unreadable" };
  }
}
