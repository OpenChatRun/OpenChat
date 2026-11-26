import { describe, expect, it } from 'vitest';
import { isNewerRelease, PROJECT_REPOSITORY_URL, releaseVersionFromUrl, software } from './software';

describe('software', () => {
  it('points at the release when the operator set no source', () => {
    expect(software({ version: '0.3.0', sourceUrl: undefined })).toEqual({
      name: 'OpenChat',
      version: '0.3.0',
      license: 'AGPL-3.0-or-later',
      source: `${PROJECT_REPOSITORY_URL}/tree/v0.3.0`,
    });
  });

  it("prefers the operator's own source", () => {
    expect(software({ version: '0.3.0', sourceUrl: 'https://git.example.com/openchat' }).source).toBe('https://git.example.com/openchat');
  });

  it('falls back to the repository without a version', () => {
    expect(software({ version: undefined, sourceUrl: undefined })).toMatchObject({ version: null, source: PROJECT_REPOSITORY_URL });
  });

  it('ignores a malformed version or a source that is not https', () => {
    expect(software({ version: 'v1; drop', sourceUrl: 'http://git.example.com' })).toMatchObject({ version: null, source: PROJECT_REPOSITORY_URL });
  });
});

describe('the newest release', () => {
  it('is read from the address GitHub redirects to, wherever the repository lives', () => {
    expect(releaseVersionFromUrl('https://github.com/OpenChatRun/OpenChat/releases/tag/v0.4.0')).toBe('0.4.0');
    expect(releaseVersionFromUrl('https://github.com/OpenChatRun/OpenChat/releases/tag/v1.12.3')).toBe('1.12.3');
  });

  it('is not read from anything else', () => {
    for (const url of ['https://github.com/OpenChatRun/OpenChat/releases', 'https://github.com/OpenChatRun/OpenChat/releases/tag/nightly', 'https://example.com/a/b/releases/tag/v9.9.9', 'https://github.com/a/b/releases/tag/v1.0.0/x', 'https://github.com/a/b/releases/tag/v1.0.0-rc.1']) {
      expect(releaseVersionFromUrl(url)).toBeNull();
    }
  });

  it('is newer by number, not by text', () => {
    expect(isNewerRelease('0.4.0', '0.3.0')).toBe(true);
    expect(isNewerRelease('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerRelease('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerRelease('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerRelease('0.3.0', '0.4.0')).toBe(false);
    expect(isNewerRelease('0.3.0', '0.3.0-dev')).toBe(true);
    expect(isNewerRelease('0.3.0', '0.4.0-dev')).toBe(false);
    expect(isNewerRelease('newest', '0.3.0')).toBe(false);
  });
});
