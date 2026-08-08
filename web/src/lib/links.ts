export const REPO_URL = 'https://github.com/julianariel/m402';

export function openRepo(path = '') {
  window.open(REPO_URL + path, '_blank', 'noopener,noreferrer');
}
