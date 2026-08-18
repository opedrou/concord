import * as React from 'react';
import { TextChannelShell } from '@/lib/TextChannelShell';

export default async function Page({ params }: { params: Promise<{ channelSlug: string }> }) {
  const { channelSlug } = await params;
  return <TextChannelShell channelSlug={channelSlug} />;
}
