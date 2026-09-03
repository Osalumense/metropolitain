/**
 * Official Paris Métro / RER line identity, pulled directly from IDFM's own first-party
 * "référentiel des lignes" dataset (data.iledefrance-mobilites.fr/.../referentiel-des-lignes),
 * not a third-party approximation. Includes:
 *  - lineRef: IDFM's own LineRef ("STIF:Line::C0xxxx:"), needed to call the real
 *    Next Departures / Traffic Info Messages APIs.
 *  - color / textColor: IDFM's own published web colors, badge fill and legible label text.
 *
 * Cross-checked against OpenStreetMap's independently-sourced `colour` tags — they agree
 * almost exactly, which is a second confirmation this is right, not a guess.
 */
export interface LineInfo {
  id: string;
  lineRef: string;
  shortName: string;
  mode: "metro" | "rer" | "transilien" | "tram";
  color: string;
  textColor: string;
}

export const LINE_REGISTRY: Record<string, LineInfo> = {
  "metro-1": { id: "metro-1", lineRef: "STIF:Line::C01371:", shortName: "1", mode: "metro", color: "#ffbe00", textColor: "#000000" },
  "metro-2": { id: "metro-2", lineRef: "STIF:Line::C01372:", shortName: "2", mode: "metro", color: "#0055c8", textColor: "#ffffff" },
  "metro-3": { id: "metro-3", lineRef: "STIF:Line::C01373:", shortName: "3", mode: "metro", color: "#6e6e00", textColor: "#ffffff" },
  "metro-3bis": { id: "metro-3bis", lineRef: "STIF:Line::C01386:", shortName: "3bis", mode: "metro", color: "#82c8e6", textColor: "#000000" },
  "metro-4": { id: "metro-4", lineRef: "STIF:Line::C01374:", shortName: "4", mode: "metro", color: "#a0006e", textColor: "#ffffff" },
  "metro-5": { id: "metro-5", lineRef: "STIF:Line::C01375:", shortName: "5", mode: "metro", color: "#ff5a00", textColor: "#000000" },
  "metro-6": { id: "metro-6", lineRef: "STIF:Line::C01376:", shortName: "6", mode: "metro", color: "#82dc73", textColor: "#000000" },
  "metro-7": { id: "metro-7", lineRef: "STIF:Line::C01377:", shortName: "7", mode: "metro", color: "#ff82b4", textColor: "#000000" },
  "metro-7bis": { id: "metro-7bis", lineRef: "STIF:Line::C01387:", shortName: "7bis", mode: "metro", color: "#82dc73", textColor: "#000000" },
  "metro-8": { id: "metro-8", lineRef: "STIF:Line::C01378:", shortName: "8", mode: "metro", color: "#d282be", textColor: "#000000" },
  "metro-9": { id: "metro-9", lineRef: "STIF:Line::C01379:", shortName: "9", mode: "metro", color: "#d2d200", textColor: "#000000" },
  "metro-10": { id: "metro-10", lineRef: "STIF:Line::C01380:", shortName: "10", mode: "metro", color: "#dc9600", textColor: "#000000" },
  "metro-11": { id: "metro-11", lineRef: "STIF:Line::C01381:", shortName: "11", mode: "metro", color: "#6e491e", textColor: "#ffffff" },
  "metro-12": { id: "metro-12", lineRef: "STIF:Line::C01382:", shortName: "12", mode: "metro", color: "#00643c", textColor: "#ffffff" },
  "metro-13": { id: "metro-13", lineRef: "STIF:Line::C01383:", shortName: "13", mode: "metro", color: "#82c8e6", textColor: "#000000" },
  "metro-14": { id: "metro-14", lineRef: "STIF:Line::C01384:", shortName: "14", mode: "metro", color: "#640082", textColor: "#ffffff" },
  "rer-a": { id: "rer-a", lineRef: "STIF:Line::C01742:", shortName: "A", mode: "rer", color: "#eb2132", textColor: "#ffffff" },
  "rer-b": { id: "rer-b", lineRef: "STIF:Line::C01743:", shortName: "B", mode: "rer", color: "#5091cb", textColor: "#ffffff" },
  "rer-c": { id: "rer-c", lineRef: "STIF:Line::C01727:", shortName: "C", mode: "rer", color: "#ffcc30", textColor: "#000000" },
  "rer-d": { id: "rer-d", lineRef: "STIF:Line::C01728:", shortName: "D", mode: "rer", color: "#008b5b", textColor: "#ffffff" },
  "rer-e": { id: "rer-e", lineRef: "STIF:Line::C01729:", shortName: "E", mode: "rer", color: "#b94e9a", textColor: "#ffffff" },
  "transilien-h": { id: "transilien-h", lineRef: "STIF:Line::C01737:", shortName: "H", mode: "transilien", color: "#84653d", textColor: "#ffffff" },
  "transilien-j": { id: "transilien-j", lineRef: "STIF:Line::C01739:", shortName: "J", mode: "transilien", color: "#cec73d", textColor: "#000000" },
  "transilien-k": { id: "transilien-k", lineRef: "STIF:Line::C01738:", shortName: "K", mode: "transilien", color: "#9b9842", textColor: "#ffffff" },
  "transilien-l": { id: "transilien-l", lineRef: "STIF:Line::C01740:", shortName: "L", mode: "transilien", color: "#c4a4cc", textColor: "#000000" },
  "transilien-n": { id: "transilien-n", lineRef: "STIF:Line::C01736:", shortName: "N", mode: "transilien", color: "#00b297", textColor: "#ffffff" },
  "transilien-p": { id: "transilien-p", lineRef: "STIF:Line::C01730:", shortName: "P", mode: "transilien", color: "#f58f53", textColor: "#000000" },
  "transilien-r": { id: "transilien-r", lineRef: "STIF:Line::C01731:", shortName: "R", mode: "transilien", color: "#f49fb3", textColor: "#000000" },
  "transilien-u": { id: "transilien-u", lineRef: "STIF:Line::C01741:", shortName: "U", mode: "transilien", color: "#b6134c", textColor: "#ffffff" },
  // Trams keep IDFM's own shortname ("T1", not "1") rather than a prefix we'd invent —
  // it's the real official name, and it's what keeps a tram badge unambiguous from a
  // Métro badge at a glance despite several trams sharing a Métro line's exact color
  // (e.g. T8/T10 and Métro 3 are all #6e6e00 in IDFM's own palette).
  "tram-1": { id: "tram-1", lineRef: "STIF:Line::C01389:", shortName: "T1", mode: "tram", color: "#0055c8", textColor: "#ffffff" },
  "tram-2": { id: "tram-2", lineRef: "STIF:Line::C01390:", shortName: "T2", mode: "tram", color: "#a0006e", textColor: "#ffffff" },
  "tram-3a": { id: "tram-3a", lineRef: "STIF:Line::C01391:", shortName: "T3a", mode: "tram", color: "#ff5a00", textColor: "#000000" },
  "tram-3b": { id: "tram-3b", lineRef: "STIF:Line::C01679:", shortName: "T3b", mode: "tram", color: "#00643c", textColor: "#ffffff" },
  "tram-4": { id: "tram-4", lineRef: "STIF:Line::C01843:", shortName: "T4", mode: "tram", color: "#dc9600", textColor: "#000000" },
  "tram-5": { id: "tram-5", lineRef: "STIF:Line::C01684:", shortName: "T5", mode: "tram", color: "#640082", textColor: "#ffffff" },
  "tram-6": { id: "tram-6", lineRef: "STIF:Line::C01794:", shortName: "T6", mode: "tram", color: "#ff0000", textColor: "#ffffff" },
  "tram-7": { id: "tram-7", lineRef: "STIF:Line::C01774:", shortName: "T7", mode: "tram", color: "#6e491e", textColor: "#ffffff" },
  "tram-8": { id: "tram-8", lineRef: "STIF:Line::C01795:", shortName: "T8", mode: "tram", color: "#6e6e00", textColor: "#ffffff" },
  "tram-9": { id: "tram-9", lineRef: "STIF:Line::C02317:", shortName: "T9", mode: "tram", color: "#3c91dc", textColor: "#ffffff" },
  "tram-10": { id: "tram-10", lineRef: "STIF:Line::C02528:", shortName: "T10", mode: "tram", color: "#6e6e00", textColor: "#ffffff" },
  "tram-11": { id: "tram-11", lineRef: "STIF:Line::C01999:", shortName: "T11", mode: "tram", color: "#ff5a00", textColor: "#000000" },
  "tram-12": { id: "tram-12", lineRef: "STIF:Line::C02529:", shortName: "T12", mode: "tram", color: "#a50034", textColor: "#ffffff" },
  "tram-13": { id: "tram-13", lineRef: "STIF:Line::C02344:", shortName: "T13", mode: "tram", color: "#8d653d", textColor: "#ffffff" },
  "tram-14": { id: "tram-14", lineRef: "STIF:Line::C02732:", shortName: "T14", mode: "tram", color: "#00a092", textColor: "#ffffff" },
};
