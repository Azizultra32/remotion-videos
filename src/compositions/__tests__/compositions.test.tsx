import { describe, it, expect } from 'vitest';
import React from 'react';

// Test that all compositions can be imported
describe('Composition imports', () => {
  it('imports TextOverlay', async () => {
    const mod = await import('../TextOverlay');
    expect(mod.TextOverlay).toBeDefined();
  });

  it('imports ProductDemo', async () => {
    const mod = await import('../ProductDemo');
    expect(mod.ProductDemo).toBeDefined();
  });

  it('imports BrandedDemo', async () => {
    const mod = await import('../BrandedDemo');
    expect(mod.BrandedDemo).toBeDefined();
  });

  it('imports AdCreative', async () => {
    const mod = await import('../AdCreative');
    expect(mod.AdCreative).toBeDefined();
  });

  it('imports VideoStitcher', async () => {
    const mod = await import('../VideoStitcher');
    expect(mod.VideoStitcher).toBeDefined();
  });

  it('imports MapAnimation', async () => {
    const mod = await import('../MapAnimation');
    expect(mod.MapAnimation).toBeDefined();
  });

  it('imports ExplainerVideo', async () => {
    const mod = await import('../ExplainerVideo');
    expect(mod.ExplainerVideo).toBeDefined();
  });

  it('imports SocialProof', async () => {
    const mod = await import('../SocialProof');
    expect(mod.SocialProof).toBeDefined();
  });

  it('imports MMXPipelineReport', async () => {
    const mod = await import('../MMXPipelineReport');
    expect(mod.MMXPipelineReport).toBeDefined();
  });
});
