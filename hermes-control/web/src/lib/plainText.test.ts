import { describe, expect, it } from 'vitest';
import { plainText } from '../components/Shell';

describe('chat preview plain text', () => {
  it('strips markdown formatting', () => {
    expect(plainText("[FAKE HERMES] **Here's today**, based on _this_\n\n## Priorities\n1. **Budget** review\n- [x] Done\n| a | b |\n|---|---|\n| c | d |\nSee [the docs](https://x.y) and `code`."))
      .toBe("[FAKE HERMES] Here's today, based on this Priorities Budget review Done a b c d See the docs and code.");
  });
});
