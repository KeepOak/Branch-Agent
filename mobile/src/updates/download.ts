import { cacheDirectory, createDownloadResumable, makeDirectoryAsync } from 'expo-file-system/legacy';
import { VerifyError } from './verify';

export async function cacheDir(): Promise<string> {
  if (!cacheDirectory) throw new VerifyError('This phone has no place to keep the update.');
  return cacheDirectory;
}

export async function downloadToFile(
  url: string,
  dest: string,
  onProgress: (progress: number) => void,
): Promise<void> {
  const folder = dest.slice(0, dest.lastIndexOf('/') + 1);
  await makeDirectoryAsync(folder, { intermediates: true });
  const job = createDownloadResumable(url, dest, {}, ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
    onProgress(totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0);
  });
  await job.downloadAsync();
  onProgress(1);
}

export async function readRemoteText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: 'text/plain', 'User-Agent': 'Branch-Android' },
  });
  if (!response.ok) throw new VerifyError('Couldn’t download the update’s checksum.');
  return response.text();
}
