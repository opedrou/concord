// Regra única de senha do sistema (S4). Antes o mínimo era de 8 caracteres,
// repetido em quatro lugares, e "12345678" passava.
//
// Este arquivo é importado tanto pelas rotas de API quanto por componentes
// client (app/admin/UsersPanel.tsx, app/profile/ProfileClientImpl.tsx), então
// é TypeScript puro: sem `node:crypto`, sem banco, sem nada só-de-servidor.
// A checagem do client é feedback de UX; quem decide é sempre o servidor.
//
// SOBRE A LISTA DE SENHAS COMUNS ABAIXO: é um subconjunto escrito à mão, não
// as "10k mais comuns" do plano. O caminho completo — a API do Have I Been
// Pwned por k-anonimato, ou embutir a lista de 10k — está pendente de decisão
// do Pedro, porque a primeira opção é chamada de rede saindo do servidor.
// Ampliar é só acrescentar linhas em COMMON_PASSWORDS; nada mais muda.

/** Mínimo de caracteres. Exportado pro client montar o texto de ajuda sem repetir o número. */
export const PASSWORD_MIN_LENGTH = 12;

/** Máximo de caracteres. Senha gigante vira DoS do scrypt, que é caro de propósito. */
export const PASSWORD_MAX_LENGTH = 200;

/** Código de erro que a rota devolve no `{ error: ... }`. */
export type PasswordErrorCode = 'password_too_short' | 'password_too_weak';

export interface PasswordProblem {
  /** `password_too_short` é o código antigo, que a UI já trata. O resto é `password_too_weak`. */
  code: PasswordErrorCode;
  /** Motivo em pt-BR, pronto pra mostrar. Vai no corpo da resposta como `reason`. */
  reason: string;
}

// Senhas óbvias, sempre em minúsculas. Subconjunto escrito à mão (ver cabeçalho).
const COMMON_PASSWORDS = new Set([
  // teclado / dígitos
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '12345',
  '1234',
  '111111',
  '000000',
  '123123',
  '112233',
  '121212',
  '654321',
  '987654321',
  '147258369',
  '159753',
  'qwerty',
  'qwertyui',
  'qwertyuiop',
  'qwerty123',
  'qwerty1234',
  'qwe123',
  'qweasd',
  'qweasdzxc',
  'asdfgh',
  'asdfghjk',
  'asdfghjkl',
  'asdasd',
  'asdf1234',
  'zxcvbn',
  'zxcvbnm',
  'zaq12wsx',
  '1q2w3e4r',
  '1q2w3e4r5t',
  '1qaz2wsx',
  'abc123',
  'abcd1234',
  'abcdef',
  'abcdefg',
  'a1b2c3',
  // inglês
  'password',
  'password1',
  'password123',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'letmein',
  'welcome',
  'welcome1',
  'welcome123',
  'admin',
  'admin123',
  'administrator',
  'root',
  'toor',
  'guest',
  'test',
  'test123',
  'testing',
  'default',
  'changeme',
  'change123',
  'secret',
  'secret123',
  'login',
  'master',
  'access',
  'shadow',
  'dragon',
  'monkey',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'basketball',
  'superman',
  'batman',
  'iloveyou',
  'trustno1',
  'whatever',
  'freedom',
  'starwars',
  'pokemon',
  'computer',
  'internet',
  'michael',
  'jennifer',
  'jordan23',
  'hunter2',
  'ashley',
  'charlie',
  'thomas',
  'robert',
  'daniel',
  'matthew',
  'anthony',
  'summer',
  'winter',
  'chocolate',
  'butterfly',
  'flower',
  'purple',
  'orange',
  'silver',
  'cookie',
  'ginger',
  'pepper',
  'soccer',
  'hockey',
  'killer',
  'hello',
  'hello123',
  'nothing',
  'forever',
  'loveme',
  'lovely',
  'blessed',
  'jesus',
  'jesus123',
  'god123',
  // português
  'senha',
  'senha123',
  'senha1234',
  'senha12345',
  'senha@123',
  'minhasenha',
  'suasenha',
  'novasenha',
  'senhanova',
  'senhaforte',
  'senhasegura',
  'trocarsenha',
  'mudar123',
  'mudarsenha',
  'mudei123',
  'usuario',
  'usuario123',
  'administrador',
  'gerente',
  'diretor',
  'empresa',
  'empresa123',
  'trabalho',
  'escritorio',
  'reuniao',
  'chamada',
  'brasil',
  'brasil123',
  'brasil2022',
  'brasil2024',
  'saopaulo',
  'riodejaneiro',
  'saudade',
  'coracao',
  'familia',
  'amigos',
  'amor',
  'amor123',
  'teamo',
  'teamomuito',
  'meuamor',
  'felicidade',
  'liberdade',
  'esperanca',
  'deusefiel',
  'deusnocontrole',
  'jesuscristo',
  'jesusteama',
  'obrigado',
  'bemvindo',
  'benvindo',
  'primeiro',
  'segredo',
  'segredo123',
  'cachorro',
  'cachorro123',
  'gatinho',
  'futebol',
  'futebol123',
  'flamengo',
  'corinthians',
  'palmeiras',
  'saopaulofc',
  'santos',
  'gremio',
  'internacional',
  'cruzeiro',
  'atletico',
  'atleticomineiro',
  'vasco',
  'botafogo',
  'fluminense',
  'bahia',
  'sport',
  'fortaleza',
  'ceara',
  'curintia',
  'mengao',
  'verdao',
  'timao',
  'galo',
  'peixe',
  'colorado',
  'tricolor',
  'campeao',
  'carnaval',
  'churrasco',
  'feijoada',
  'cerveja',
  'cachaca',
  'guarana',
  'novembro',
  'dezembro',
  'janeiro',
  'fevereiro',
  'setembro',
  'outubro',
  'verao',
  'inverno',
  'domingo',
  'segunda',
  'aniversario',
  'nascimento',
  'telefone',
  'celular',
  'endereco',
  'documento',
  'cadastro',
  'sistema',
  'servidor',
  'projeto',
  'concord',
  'concord123',
]);

// Sequências triviais: se a senha inteira (em minúsculas) for um pedaço de
// alguma destas — em qualquer direção — não vale como senha.
const SEQUENCES = [
  '01234567890123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
  'qazwsxedcrfvtgbyhnujmikolp',
];

function isSequence(value: string): boolean {
  for (const seq of SEQUENCES) {
    const reversed = [...seq].reverse().join('');
    if (seq.includes(value) || reversed.includes(value)) return true;
  }
  return false;
}

/**
 * Valida uma senha nova. Devolve `null` se passou, ou o motivo da recusa pra
 * quem chamou transformar no seu próprio `{ error: ... }`.
 *
 * @param username quando existir — a senha não pode conter o nome de usuário.
 */
export function checkPassword(password: string, username?: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      code: 'password_too_short',
      reason: `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      code: 'password_too_weak',
      reason: `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    };
  }

  const normalized = password.trim().toLowerCase();

  if (/^(.)\1*$/.test(normalized)) {
    return { code: 'password_too_weak', reason: 'A senha não pode ser um caractere repetido.' };
  }
  if (isSequence(normalized)) {
    return {
      code: 'password_too_weak',
      reason: 'A senha não pode ser uma sequência do teclado ou de números.',
    };
  }

  // Também recusa a senha comum com dígitos grudados no fim ("senha12345678"),
  // senão o mínimo de 12 caracteres tornaria a lista quase inútil.
  const withoutTrailingDigits = normalized.replace(/[0-9]+$/, '');
  if (COMMON_PASSWORDS.has(normalized) || COMMON_PASSWORDS.has(withoutTrailingDigits)) {
    return {
      code: 'password_too_weak',
      reason: 'Essa senha é comum demais. Escolha outra.',
    };
  }

  const user = (username ?? '').trim().toLowerCase();
  if (user.length >= 3 && normalized.includes(user)) {
    return {
      code: 'password_too_weak',
      reason: 'A senha não pode conter o nome de usuário.',
    };
  }

  return null;
}
