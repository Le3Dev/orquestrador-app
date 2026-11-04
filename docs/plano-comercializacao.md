# Plano de Comercialização — Orquestrador de Agentes

Plano para transformar o app num produto vendável: de servidor local + SPA no navegador para um produto desktop com licenciamento e proteção contra pirataria.

## Contexto atual (importante)

- O projeto **HOJE NÃO é Electron**. É um servidor Express local (`src/root.ts`) que serve uma SPA React (`web/`) e abre a URL no navegador padrão via `iniciar-orquestrador.cmd` (linha ~29: `start http://localhost:3200`).
- A "barra de título nativa" com menu File/Edit/View/Window é a **janela do NAVEGADOR**, não código do projeto.
- O cabeçalho bonito (logo, "+ Novo orquestrador", "+ notas", "Organizar", "TODOS OCIOSOS", RAM) é React em `web/src/componentes/canvas/PaineisDoCanvas.tsx`.

## Parte 1 — Transformar em produto desktop (janela única)

### Opção B (ajuste rápido, sem migrar)

- Trocar a linha do `iniciar-orquestrador.cmd` para abrir o navegador em **modo app**:
  `start chrome --app=http://localhost:3200` (ou `msedge --app=...`).
- Remove abas e menu, mantém os botões nativos de min/max/fechar. **Zero código novo.**
- Bom para **MVP / validação**.

### Opção A (produto desktop real — recomendado para vender)

- Adicionar **Electron**. Criar janela com:
  - `titleBarStyle: 'hidden'` + `titleBarOverlay` (melhor que `frame:false` puro no Windows);
  - `Menu.setApplicationMenu(null)`;
  - região de arrasto no cabeçalho (`-webkit-app-region: drag`);
  - botões próprios de janela via IPC.
- **Reusar o servidor Express atual** (`win.loadURL('http://localhost:3200')`).
- **Riscos:**
  - perder atalhos nativos (copiar/colar, zoom);
  - reimplementar snap/arraste no Windows;
  - adicionar build/empacotamento (`electron-builder`), que hoje não existe.
- **ATENÇÃO:** verificar se já existe um wrapper/empacotador desktop **fora deste worktree** (o app roda em `AppData\Roaming\orquestrador-agentes-app`). Se existir, a mudança da janela seria naquele projeto.

## Parte 2 — Licenciamento e anti-pirataria

### Verdade fundamental

- É **impossível impedir 100%** a cópia de um `.exe` (código client-side é reversível). A defesa real é **ATIVAÇÃO ONLINE + vínculo a hardware + lógica de valor no servidor**, não "blindar" o binário.

### Arquitetura recomendada (mínima viável)

```
Lemon Squeezy  -> checkout + emite license key + entrega do .exe + resolve impostos globais (Merchant of Record)
      | webhook de compra
      v
Backend leve (Node/Express) + banco de licencas/fingerprints/ativacoes
      v
App Electron no startup: coleta fingerprint de hardware -> POST /activate -> licenca assinada em cache criptografado
                -> revalida a cada 7-30 dias, com grace period offline (14-30 dias) e degradacao graciosa
```

### Escolhas de ferramentas

- **Pagamento:**
  - **Lemon Squeezy** (Merchant of Record, resolve imposto global, ~5%/transação); OU
  - **Stripe** (taxa ~2.9% + US$0,30, mas você cuida do imposto e constrói a licença).
- **Licenciamento:**
  - license keys do próprio **Lemon Squeezy**; OU
  - **Keygen** (tem Community self-hosted grátis; fingerprint, `maxMachines`, revogação, update assinado integrado ao `electron-builder`).
- **Fingerprint em Electron:** combinar 2–3 sinais estáveis (machine-GUID via `node-machine-id`, serial de disco, MAC) e fazer hash. **Não depender de um único dado volátil.**

### Fator mais forte no NOSSO caso

- O app **orquestra agentes / chama IA**. Mover as chamadas de IA/orquestração para trás de uma **API autenticada por licença** torna um `.exe` pirata inútil (o "motor" vive no servidor). Essa é a melhor proteção contra repasse.

### Ofuscação (deterrente secundário, fazer por último)

- `asar` + ASAR integrity (não é criptografia), `javascript-obfuscator`, `bytenode` (bytecode V8, sem decompilador público mas acoplado à versão do V8). Levanta a barra, **nunca é absoluto**.

### Boas práticas

- **Code signing** (Windows Authenticode). **ATENÇÃO:** desde mar/2026, certificados de code signing expiram em **460 dias** — planejar renovação. **EV** reduz avisos do SmartScreen.
- Limitar **1–2 máquinas por chave**, com endpoint `deactivate` para troca de PC.
- **Revogação de chaves** (chargeback/fraude) — "pega" na próxima revalidação online.
- **Grace period offline** para não punir usuário legítimo sem internet.
- **Rate limiting / detecção de abuso:** mesma chave ativando em muitas máquinas = sinal de repasse.

## Parte 3 — Roadmap sugerido (fases)

1. **MVP de validação:** Opção B (modo app) + venda manual via Lemon Squeezy (entrega do instalador por license key).
2. **Produto:** migrar para Electron (Opção A) + `electron-builder` + code signing.
3. **Licença:** integrar ativação online (Lemon Squeezy keys ou Keygen) com fingerprint e revalidação periódica.
4. **Blindagem:** mover features de IA para API autenticada por licença; depois obfuscação/bytecode.
5. **Operação:** auto-update assinado, painel de revogação, métricas de ativação.

## Fontes de referência (licenciamento)

- Keygen (`keygen.sh/for-electron-apps`)
- Lemon Squeezy / Stripe / Paddle (comparativos MoR 2026)
- electron-vite Source Code Protection (bytecode)
- Boas práticas de ativação online e prevenção de pirataria
