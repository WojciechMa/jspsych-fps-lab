// public/wads/manifest.json (written by npm run build:maps): the map WADs a study can load, with
// hashes and the maps they put into MAPxx slots. iwad.json: the trimmed IWAD (npm run build:iwad).
import iwad from './iwad.json';

/** The IWAD studies load (gzipped) and the classic maps it has. */
export const IWAD: { name: string; maps: readonly number[] } = { name: iwad.name, maps: iwad.maps };
export interface ManifestMap {
  slot: number;
  name: string;
  paradigm: string;
  /** ROI names by sector tag. */
  rois: Record<string, string>;
}

export interface ManifestWad {
  bytes: number;
  sha256: string;
  source: string;
  maps: ManifestMap[];
}

export interface WadManifest {
  wads: Record<string, ManifestWad>;
}

export interface StudyMap extends ManifestMap {
  wad: string;
}

export const mapLabel = (slot: number): string => `MAP${String(slot).padStart(2, '0')}`;

/** The maps a study's WADs put into MAPxx slots, plus problems (unknown WADs, a slot used twice). */
export function studyMaps(wads: readonly string[], manifest: WadManifest): { maps: Map<number, StudyMap>; problems: string[] } {
  const maps = new Map<number, StudyMap>();
  const problems: string[] = [];
  if (new Set(wads).size !== wads.length) problems.push('config.wads lists a WAD twice');
  for (const wad of wads) {
    const entry = Object.hasOwn(manifest.wads, wad) ? manifest.wads[wad] : undefined;
    if (!entry) {
      problems.push(`config.wads: ${wad} is not in wads/manifest.json (known: ${Object.keys(manifest.wads).join(', ') || 'none'})`);
      continue;
    }
    for (const map of entry.maps) {
      const taken = maps.get(map.slot);
      if (taken && taken.wad !== wad) {
        problems.push(`config.wads: ${wad} and ${taken.wad} both define ${mapLabel(map.slot)}`);
      }
      maps.set(map.slot, { ...map, wad });
    }
  }
  return { maps, problems };
}
