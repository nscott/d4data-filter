import { glob } from "glob";
import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';

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
  debugFiles: string[];
  filesToProcess: string[];

  constructor(prefix: string, dataDir: string, enableDebug?: boolean) {
    this.prefix = prefix;
    this.dataDir = dataDir;
    this.path = `${this.dataDir}/json/base/meta`;
    this.outputDir = "./output";
    this.filesToProcess = [];
    this.debug = enableDebug || false;
    // A helpful list of files to check for parsing problems
    // If all of these work, it's likely whatever changes you make will also work.
    this.debugFiles = [
      'Actor/TWN_Step_KedBardu_Sign_OxenGod.acr.json', 
      'SkillKit/Necromancer.skl.json', 
      'EffectGroup/Conv_QST_Step_LorathOpt_Meshif.efg.json',
      'MarkerSet/Scos_Moors (Town_Tirmair_Base).mrk.json',
      'Quest/Dungeon_Affix_HellPortal.qst.json',
      'Quest/SMP_WishingWell.qst.json',
      'ParagonBoard/Paragon_Sorc_00.pbd.json',
    ];
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

      promises.push(this.writeFile(fileName, asStr));

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
      for(let str of this.debugFiles) {
        result.push(`${this.path}/${str}`);
      }
      return result;
    }

    return await glob(`${this.path}/**/*.json`);
  }

  async writeFile(origFileName: string, content: string): Promise<void> {
    // Remove the relative pathing info
    const newFileName = origFileName.replace(this.path, this.outputDir);
    await this.createDirectories(newFileName);
    try {
      return fs.writeFile(newFileName, JSON.stringify(JSON.parse(content), null, 2), { encoding: 'utf8' });
    } catch(e: any) {
      console.log(`Could not write file '${newFileName}': ${e.message}`);
      return;
    }
  }

  async createDirectories(fileName: string): Promise<void> {
    const dirName = path.dirname(fileName);
    await fs.mkdir(dirName, { recursive: true });
    return;
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

    const strToAppend = `"${this.prefix}_strings":${JSON.stringify(addition)}`;

    // Open the object and shove this in at the end.
    content = content.trim();
    content = content.substring(0, content.length - 1);
    content = `${content},${strToAppend}}`
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

export default D4DataFilter;