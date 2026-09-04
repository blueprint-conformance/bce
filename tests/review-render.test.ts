import { describe, expect, it } from 'vitest';
import { renderReviewPacketHtml, renderReviewPacketText, reviewSafeText } from '../src/review-render.js';
import { makeDraftPlanFixture, makeProposalContextFixture, makeProposalFixture, makeReviewFixture } from './review-fixture.js';

describe('review renderers', () => {
  it('renders the same four-part clause grammar in text and HTML', () => {
    const packet = makeReviewFixture().packet;
    const text = renderReviewPacketText(packet);
    const html = renderReviewPacketHtml(packet);
    for (const heading of ['Promise', 'Lens', 'Proof', 'Limits']) {
      expect(text).toContain(`${heading}:`);
      expect(html).toContain(`<dt>${heading}</dt>`);
    }
    expect(renderReviewPacketText(packet)).toBe(text);
    expect(renderReviewPacketHtml(packet)).toBe(html);
    expect(text).toContain(`Packet: sha256:${packet.packetDigest}`);
  });

  it('escapes active HTML and strips ANSI, control, and bidi spoofing', () => {
    const context = makeProposalContextFixture();
    const plan = makeDraftPlanFixture(context);
    plan.clauses[0]!.constraint.id = '<script>alert(1)</script>\u001b[31mRED\u202E';
    const packet = makeReviewFixture({ proposal: makeProposalFixture(context, plan) }).packet;
    const html = renderReviewPacketHtml(packet);
    const text = renderReviewPacketText(packet);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;RED');
    expect(text).toContain('<script>alert(1)</script>RED');
    expect(text).not.toContain('\u001b');
    expect(reviewSafeText('safe\u0000\u202Etext')).toBe('safetext');
  });

  it('refuses to render schema-valid evidence whose digest does not verify', () => {
    const packet = makeReviewFixture().packet;
    packet.contract.plainLanguageContract = 'tampered';
    expect(() => renderReviewPacketText(packet)).toThrow(/refusing to render invalid/);
    expect(() => renderReviewPacketHtml(packet)).toThrow(/refusing to render invalid/);
  });
});
