import * as React from 'react';
import { RoomShell } from '@/lib/RoomShell';
import { isVideoCodec } from '@/lib/types';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    // FIXME: We should not allow values for regions if in playground mode.
    region?: string;
    hq?: string;
    codec?: string;
    singlePC?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'vp9';
  const hq = _searchParams.hq === 'true' ? true : false;
  const singlePC = _searchParams.singlePC !== 'false';

  return (
    <RoomShell
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      singlePeerConnection={singlePC}
    />
  );
}
