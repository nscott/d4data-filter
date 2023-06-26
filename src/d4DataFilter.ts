import { glob } from "glob";
import fs from 'fs/promises';
import process from 'node:process';
import DEBUG_FILES from "./debugFiles.js";
import { writeJSONFile } from "./utils.js";

export class D4DataFilter {
  // TODO: Add basic full-text string filters for entire segments we'd like to remove.

  // This filter finds "value":-1 in the text and removes it along with the key.
  ENABLE_NEG_1_FILTER = true;
  // This filter finds "value":4294967295 and removes it along with the key.
  ENABLE_MAX_INT_FILTER = true;

  // This is used to smoosh together the files with their extracted strings
  EXT_TO_STR_PREFIX = new Map<string, string>(Object.entries({
    "act": "Activity",
    "acr": "Actor",
    "ach": "Achievement",
    "aff": "Affix",
    "BNET_UNKNOWN": "Bnet",
    "cha": "Challenge",
    "CHAR_UNKNOWN": "Character",
    "CLAN_UNKNOWN": "Clan",
    "cnd": "Condition",
    "cnv": "Conv",
    "dax": "DungeonAffix",
    "dye": "Dye",
    "emb": "Emblem",
    "emo": "Emote",
    "eye": "EyeColor",
    "hcl": "HairColor",
    "itm": "Item",
    "lvl": "LevelArea",
    "mcl": "MarkingColor",
    "maf": "MonsterAffix",
    "mfm": "MonsterFamily",
    "MOV_SUB_UNKNOWN": "MovSub",
    "pbd": "ParagonBoard",
    "gph": "ParagonGlyph",
    "gaf": "ParagonGlyphAffix",
    "pgn": "ParagonNode",
    "pt": "PlayerTitle",
    "pow": "Power",
    "qst": "Quest",
    "qc": "QuestChain",
    "RARE_NAME_STRINGS_UNKNOWN": "RareNameStrings",
    "rcp": "Recipe",
    "prd": "StoreProduct",
    "SURVEY_UNKNOWN": "Survey",
    "TERRITORY_UNKNOWN": "Territory",
    "tut": "Tutorial",
    "wrl": "World",
  }));

  prefix: string;
  dataDir: string;
  outputDir: string;
  path: string;
  debug: boolean;
  filesToProcess: string[];

  constructor(prefix: string, dataDir: string, enableDebug?: boolean) {
    this.prefix = prefix;
    this.dataDir = dataDir;
    this.path = `${this.dataDir}/json/base/meta`;
    this.outputDir = "./output";
    this.filesToProcess = [];
    this.debug = enableDebug || false;
  }

  async process(): Promise<void> {
    const fileNames = await this.fileList();
    const promises = []
    for(let fileName of fileNames) {
      const fileData = await fs.readFile(fileName, { encoding: 'utf8' });
      const asObj = JSON.parse(fileData);
      let asStr = JSON.stringify(asObj);
      if (this.ENABLE_NEG_1_FILTER) {
        asStr = this.removeObjWithString(asStr, '"value":-1');
      }
  
      if (this.ENABLE_MAX_INT_FILTER) {
        asStr = this.removeObjWithString(asStr, '"value":4294967295');
      }

      asStr = this.removeEmptyObjs(asStr);
      
      asStr = await this.addStrings(asStr, fileName);

      asStr = this.addSnoRelationships(asStr, fileName);

      const newFileName = fileName.replace(this.path, this.outputDir);
      promises.push(writeJSONFile(newFileName, asStr));

      process.send!({cmd: "fileProcessed"});
    }
    await Promise.all(promises);
  }

  /**
   * Get all the files to process
   * @returns A list of files to process
   */
  async fileList(): Promise<string[]> {
    if (this.filesToProcess.length > 0) {
      return this.filesToProcess;
    }

    if (this.debug) {
      const result: string[] = [];
      for(let str of DEBUG_FILES) {
        result.push(`${this.path}/${str}`);
      }
      return result;
    }

    return await glob(`${this.path}/**/*.json`);
  }

  /**
   * Remove any object with the `value` attribute set to `value` from the string.
   * 
   * @param haystack The file content
   * @param needle The content to search for. The entire object will be removed.
   * @returns The string with no nested objects that have a string in the format of `"value":$VALUE`.
   */
  removeObjWithString(haystack: string, needle: string): string {
    let needleLoc = 0;
    do {
      // We can get away with the static +1 since the file should always start with at least a curly brace.
      needleLoc = haystack.indexOf(needle, needleLoc + 1);
      if (needleLoc === -1) {
        continue;
      }

      // We read up to the first curly, then down to make sure there's no opening curly afterwards.
      // We don't want to remove nested objects.
      const openingCurly = haystack.lastIndexOf('{', needleLoc);
      const endingCurly = haystack.indexOf('}', needleLoc);
      const nestedObjIndicatorBefore = haystack.lastIndexOf('}', needleLoc);
      const nestedObjIndicatorAfter = haystack.indexOf('{', needleLoc);
      // Do we have a '{' after our needle that is also BEFORE the closing curly? Nested!
      // Do we have a '}' before our needle that is AFTER the opening curly? Nested!
      if ((nestedObjIndicatorAfter !== -1 && nestedObjIndicatorAfter < endingCurly) ||
          (nestedObjIndicatorBefore !== -1 && nestedObjIndicatorBefore > openingCurly)) {
        // TODO: Nested object support?? Probably overkill.
        // Skip this iteration - nested object
        continue;
      }

      const firstHalf = haystack.substring(0, openingCurly + 1);
      const lastHalf = haystack.substring(endingCurly);
      haystack = `${firstHalf}${lastHalf}`;
      // Move the needle back to just after the firstHalf.
      needleLoc = openingCurly + 1;
    } while(needleLoc !== -1 && needleLoc != haystack.length)
    
    return haystack;
  }


  /**
   * Remove empty objects and arrays from the haystack.
   * 
   * @param haystack The string to look through
   * @returns A modified haystack with no more empty objects or arrays
   */
  removeEmptyObjs(haystack: string): string {
    const removeNeedle = function(haystack: string, needle: string): string {
      let needleLoc = 0;
      do {
        needleLoc = haystack.indexOf(needle, needleLoc);
        if (needleLoc === -1) {
          continue;
        }

        let start = needleLoc;
        let end = needleLoc + needle.length;
        let keyEnd = haystack.lastIndexOf('":', needleLoc);
        const prevObj = haystack.lastIndexOf("},", needleLoc);
        const arrStart = haystack.lastIndexOf("[", needleLoc - 1);

        // Are we in an array or not?
        if(keyEnd > prevObj && keyEnd > arrStart) {
          // Probably an object - remove it's key too
          // We have a regular empty object.
          // Let's remove the key for this empty obj.
          keyEnd = haystack.lastIndexOf('"', needleLoc);
          start = haystack.lastIndexOf('"', keyEnd - 1);
          
          if (start + 2 == keyEnd) {
            // This indicates it's very likely we have a needle inside of a string
            // This isn't something we want to remove, so skip it
            needleLoc += needle.length;
            continue;
          }

          if (haystack[start - 1] === ",") {
            // We should remove prior commas instead of trailing commas.
            // Imagine {"a":1,"b":{}}
            // If we only removed trailing, we'd get {"a":1,} - that's not valid JSON
            start -= 1
          }
        } else {
          if (haystack[start - 1] === '[' && haystack[end] === ",") {
            // Remove the trailing comma if we're at the start of the array
            // substring is inclusive of start, exclusive of end, which is why we increment here.
            end += 1
          } else if (haystack[start - 1] === ',') {
            // Remove the comma before this item
            start -= 1;
          }
        }
        const firstHalf = haystack.substring(0, start);
        const lastHalf = haystack.substring(end);
        haystack = `${firstHalf}${lastHalf}`;
        // Move the needle back to where we just ended.
        needleLoc = start;
      } while(needleLoc !== -1 && needleLoc != haystack.length)

      return haystack;
    }
    haystack = removeNeedle(haystack, "{}");
    return removeNeedle(haystack, "[]");
  }

  /**
   * Hydrate parsed JSON meta files with their matching string data.
   * 
   * @param content The file content
   * @param fileName The name of the file
   * @return The content with any available string file data added in.
   */
  async addStrings(content: string, fileName: string): Promise<string> {
    const strFileName = this.strFileName(fileName);
    // No string file
    if(!strFileName) {
      return content;
    }

    let strFileData = "";
    try {
      strFileData = await fs.readFile(strFileName, { encoding: 'utf8' });
    } catch(e: any) {
      // We may not have string data for this file which is expected.
      // If that's NOT the error we get, log it.
      if (e != null && e.code !== "ENOENT") {
        console.log(e);
      }
      return content;
    }
    const strData = JSON.parse(strFileData);
    if (!strData.arStrings || strData.arStrings.length === 0) {
      // No strings to work with
      return content;
    }

    const addition = [];
    for(let desc of strData.arStrings) {
      const newObj = {
        szLabel: desc.szLabel,
        szText: desc.szText,
        hLabel: desc.hLabel
      }
      addition.push(newObj);
    }

    content = this.addObjToFile(content, "strings", addition);
    return content;
  }

  /**
   * Run through the current `content` and extract any sno relationships.
   */
  addSnoRelationships(content: string, fileName: string): string {
    /* 
    sno data always appears to look something like this:
    "snoSpeaker": {
      "value": 446527,
      "group": 72,
      "groupName": "Speaker",
      "type": "sno",
      "name": "NPC_QST_Lorath"
    },
    Again, we could parse the object, scan for it, etc... or we could do awful things with text parsing
    */
    const relationships: Map<string, SnoData[]> = new Map();
    let pos = 0;
    while(pos != -1 && pos < content.length) {
      // There are unks that have type: "sno" in them, so look for those and word backwards
      pos = content.indexOf('"type":"sno"', pos);
      if (pos == -1) {
        break;
      }

      const start = content.lastIndexOf("{", pos);
      const end = content.indexOf("}", pos);
      // End of substring is exclusive
      const snoStr = content.substring(start, end + 1);
      let snoData: SnoData = {value: -1, groupName: "", group: -1, type: "sno", name: ""};
      try {
        snoData = JSON.parse(snoStr);
      } catch(e: any) {
        console.log(snoStr);
        pos = end + 1;
        continue;
      }

      if (!relationships.has(snoData.groupName)) {
        relationships.set(snoData.groupName, []);
      }
      const existingData = relationships.get(snoData.groupName);
      existingData?.push(snoData);
      pos = end + 1
    }

    const result = [];
    for(const [groupName, snos] of relationships) {
      const snoVals = snos.map((s) => s.value);
      result.push({rel: groupName, snoValues: snoVals});
    }

    return this.addObjToFile(content, "snoRels", result);
  }

  /**
   * Add a new key-value pair to a file.
   * 
   * @param content The file contents
   * @param key A key to add to the file
   * @param data The data at that key
   * @returns The modified content
   */
  private addObjToFile(content: string, key: string, data: any): string {
    content = content.trim();
    // Remove the closing curly }
    content = content.substring(0, content.length - 1);
    content = `${content},"${this.prefix}_${key}":${JSON.stringify(data)}}`
    return content;
  }

  /**
   * Take in a regular data file name and create the appropriate string list file name.
   * For example, this would transform Cannibal_Rope_Bond_01.act.json to Actor_Cannibal_Rope_Bond_01.stl.json with the appropriate path.
   * 
   * @param fileName The name of the current file being parsed
   * @returns The name of the file that holds the string list, or null if there is no matching string file.
   */
  private strFileName(fileName: string): string | null {
    // Find the type of d4 file - we don't actually care about the literal extension.
    const extEnd = fileName.lastIndexOf('.');
    const extStart = fileName.lastIndexOf('.', extEnd - 1) + 1; // substring stupidity
    const d4Ext = fileName.substring(extStart, extEnd);
    const stringPrefix = this.EXT_TO_STR_PREFIX.get(d4Ext);
    if (!stringPrefix) { 
      return null;
    }

    let strippedFileName = fileName.substring(0, extStart - 1);
    // We also need to remove any possible pathing info at the start of this filename
    strippedFileName = strippedFileName.substring(strippedFileName.lastIndexOf('/') + 1);
    return `${this.dataDir}/json/enUS_Text/meta/StringList/${stringPrefix}_${strippedFileName}.stl.json`;
  }
};

export interface SnoData {
  value: number,
  group: number,
  groupName: string,
  type: string,
  name: string
}

export default D4DataFilter;