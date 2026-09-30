import { DirectoryFolderId } from './data-access/directory-folders';

export const DIRECTORY_PATHS = '/panel/directory';

/** La ruta de una carpeta: cada una es un lugar al que se navega, no un filtro del listado. */
export function directoryFolderRoute(folder: DirectoryFolderId): string {
  return `${DIRECTORY_PATHS}/${folder}`;
}
