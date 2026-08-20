/**
 * Padrao de entrada numa call quando ainda NAO ha nada salvo em localStorage
 * (primeira vez naquele navegador).
 *
 * Depois que a tela de prejoin saiu (ROADMAP item 4), ninguem escolhe mic e
 * camera antes de entrar: o estado passa a ser lembrado do ultimo uso, e este
 * e o ponto de partida. Microfone LIGADO, camera DESLIGADA — o mesmo que o
 * Discord faz, e ninguem quer descobrir que entrou com a camera aberta sem ter
 * escolhido isso.
 *
 * Precisa ser o MESMO objeto nos dois lados do `usePersistentUserChoices`
 * (quem le, em PageClientImpl; quem grava, em CallControlBar): o hook grava o
 * valor carregado logo no mount, entao um default diferente de um lado viraria
 * silenciosamente o valor salvo pro outro.
 */
export const DEFAULT_USER_CHOICES = {
  videoEnabled: false,
  audioEnabled: true,
} as const;
