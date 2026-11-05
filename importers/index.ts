import type { Importer, SourceId } from './types';
import { libbyImporter } from './libby';
import { spotifyImporter } from './spotify';

/** All file importers available in the app. Add new sources here. */
export const importers: Importer[] = [libbyImporter, spotifyImporter];

export const importerFor = (source: SourceId) => importers.find((i) => i.source === source);

export * from './types';

