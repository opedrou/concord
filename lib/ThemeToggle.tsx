'use client';

// Tema do app. Escuro e o padrao — e o tema em que o app nasceu e o que o dono
// usa.
//
// Este arquivo ja teve um botao sol/lua na barra do usuario; ele foi REMOVIDO
// a pedido do Pedro. Trocar de tema continua existindo, na secao Aparencia das
// configuracoes (lib/AppearanceSettings.tsx) — o que sumiu foi o atalho no
// rodape da sidebar. Sobraram aqui as duas constantes que aquela secao usa.
//
// O estado NAO mora em React: mora num atributo do <html>. Duas razoes.
// A primeira e que o tema precisa estar aplicado antes da primeira pintura,
// senao a tela pisca escura e depois vira clara — e nada em React roda antes
// disso (por isso o script inline no app/layout.tsx). A segunda e que o CSS ja
// e a fonte da verdade: quem le `data-concord-theme` e a folha de estilo, nao
// componente nenhum. Guardar o mesmo dado tambem num contexto so criaria duas
// versoes pra ficarem fora de sincronia.

export const THEME_STORAGE_KEY = 'concord:theme';

/** Avisa que o tema mudou. Existia pro botao sol/lua da sidebar se atualizar
 *  quando a troca vinha da secao Aparencia; com o botao removido, hoje a
 *  `AppearanceSettings` DISPARA este evento e ninguem escuta. Ficou pra quando
 *  voltar a existir um segundo lugar mostrando o tema — se isso nao acontecer,
 *  da pra apagar o evento e o dispatch de la. */
export const THEME_CHANGE_EVENT = 'concord:theme-change';
