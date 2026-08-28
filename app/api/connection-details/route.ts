// GET /api/connection-details?roomName=<slug>[&tabSessionId=<id>]
//   Emite o token do LiveKit pra sessão autenticada entrar num canal.
//   O `name` e o PREFIXO da `identity` vêm SEMPRE da sessão (nunca de query
//   string) — antes qualquer um podia se passar por qualquer nome, esse era
//   o furo principal a fechar. `roomName` precisa bater com o `slug` de um
//   canal cadastrado no banco; nome de sala arbitrário é recusado.
//   `tabSessionId` é o único input de cliente aceito: sufixo opaco da
//   identity, validado com regex estrita e substituído por um valor aleatório
//   se faltar ou não passar (ver TAB_SESSION_ID_RE abaixo).
//
//   200: { serverUrl, roomName, participantToken, participantName }
//   400: { error: 'missing_room_name' } | { error: 'not_a_voice_channel' }
//   401: { error: 'not_authenticated' }
//   404: { error: 'channel_not_found' }
//   500: { error: 'server_misconfigured' }
import { randomString } from '@/lib/client-utils';
import { requireUser } from '@/lib/api-auth';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { getDb } from '@/lib/db';
import { ConnectionDetails } from '@/lib/types';
import { AccessToken, AccessTokenOptions, VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// Postfix da identity, só pra permitir a mesma conta entrar de mais de uma
// aba/dispositivo ao mesmo tempo sem colidir identity no LiveKit.
//
// Ele é ESTÁVEL POR ABA (vem do `sessionStorage` do cliente, ver
// `getTabSessionId` em lib/client-utils.ts) e NÃO aleatório por conexão —
// isso é o conserto de um bug, não um detalhe: o LiveKit derruba sozinho a
// sessão antiga quando alguém entra com a MESMA identity de um participante
// já conectado. Com sufixo sorteado a cada chamada esse kick nativo nunca
// dispara, e toda reconexão em que o `room.disconnect()` do cliente não roda
// (F5 duro, aba fechada na marra, queda de rede) deixa a sessão velha
// pendurada no SFU: a pessoa aparece 2x, 3x na grade, com estados de mic
// diferentes, e o fantasma só some quando alguém sai. Se voltar a ser
// aleatório, o bug volta junto.
//
// É o ÚNICO input de cliente aceito por esta rota, e de propósito: é opaco,
// não identifica ninguém e só escolhe QUAL sessão da própria conta será
// derrubada. O PREFIXO (`user.username`) continua vindo só da sessão do
// servidor, então continua sendo impossível se passar por outra pessoa.
// Validado com régua curta abaixo; qualquer coisa fora dela vira sorteio.
const TAB_SESSION_ID_RE = /^[a-zA-Z0-9-]{8,36}$/;

// Sem `_` no conjunto permitido: o separador `__` da identity não pode ser
// forjado pelo cliente, nem nada que injete estrutura no token.
function identitySuffix(raw: string | null): string {
  return raw !== null && TAB_SESSION_ID_RE.test(raw) ? raw : randomString(4);
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;
  const { user } = auth;

  try {
    if (!LIVEKIT_URL || !API_KEY || !API_SECRET) {
      throw new Error('LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET não definidos');
    }

    const roomName = request.nextUrl.searchParams.get('roomName');
    if (typeof roomName !== 'string' || !roomName) {
      return NextResponse.json({ error: 'missing_room_name' }, { status: 400 });
    }

    // A sala precisa corresponder a um canal existente — recusa roomName arbitrário.
    const db = getDb();
    const channel = db.prepare('SELECT slug, type FROM channels WHERE slug = ?').get(roomName) as
      | { slug: string; type: string }
      | undefined;
    if (!channel) {
      return NextResponse.json({ error: 'channel_not_found' }, { status: 404 });
    }
    // Token do LiveKit só faz sentido pra canal de voz — canal de texto não
    // tem sala nenhuma pra entrar.
    if (channel.type !== 'voice') {
      return NextResponse.json({ error: 'not_a_voice_channel' }, { status: 400 });
    }

    const region = request.nextUrl.searchParams.get('region');
    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;

    const participantToken = await createParticipantToken(
      {
        // Prefixo/name derivados da sessão — nunca de input do cliente. Só o
        // sufixo opaco vem da aba (estável, pro kick nativo do LiveKit por
        // identity duplicada funcionar — ver o comentário no topo).
        identity: `${user.username}__${identitySuffix(
          request.nextUrl.searchParams.get('tabSessionId'),
        )}`,
        name: user.username,
      },
      roomName,
    );

    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName,
      participantToken,
      participantName: user.username,
    };
    return NextResponse.json(data);
  } catch (error) {
    console.error('[connection-details] erro:', error);
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = '5m';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    // Permite `localParticipant.setAttributes()`. Usado pelo contador de
    // espectadores da transmissao (ver lib/useScreenShareViewers.ts): o
    // LiveKit NAO diz a ninguem quantos assinantes uma track tem, entao cada
    // pessoa anuncia o que esta assistindo e os outros contam. Sem este grant
    // o `setAttributes` e recusado pelo servidor EM SILENCIO e o contador fica
    // zerado pra sempre.
    //
    // Atributo e so isso: um mapa string->string por participante, visivel pra
    // sala. Quem entrou ANTES deste grant existir continua com o token antigo
    // ate reconectar.
    canUpdateOwnMetadata: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}
