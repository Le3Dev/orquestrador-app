# Landing de venda — Orquestrador de Agentes

Site **estático** (HTML + CSS + JS vanilla) para vender o app desktop *Orquestrador de Agentes*.
Sem build, sem framework, sem dependências externas. Hospeda de graça em GitHub Pages, Netlify ou Vercel.

Fluxo do MVP: **a pessoa vê a página → paga no Lemon Squeezy → recebe a license key por e-mail e baixa o instalador → ativa a chave no app**. Não há backend próprio.

---

## Estrutura

```
site/
├── index.html      Landing (hero, recursos, como funciona, preço, FAQ, rodapé)
├── sucesso.html    Pós-compra: download + passo a passo de ativação
├── css/estilo.css  Tema escuro (laranja/coral), responsivo, mobile-first
├── js/app.js       Ano no rodapé, smooth scroll, (opcional) overlay do Lemon Squeezy
└── README.md       Este arquivo
```

---

## 1) Testar localmente

É um site estático: basta abrir `index.html` no navegador.
Para servir via HTTP (recomendado, para os links relativos funcionarem igual à produção):

```bash
# Python
python -m http.server 8080
# ou Node
npx serve .
```

Depois acesse `http://localhost:8080`.

---

## 2) Publicar de graça

### Opção A — Netlify Drop (mais rápido, sem conta de git)
1. Acesse <https://app.netlify.com/drop>.
2. Arraste a pasta `site/` inteira para a área indicada.
3. Pronto: você recebe uma URL pública. Dá para configurar domínio próprio depois.

### Opção B — Vercel
1. Suba o repositório no GitHub e importe em <https://vercel.com>.
2. Em *Root Directory*, aponte para `site/`.
3. Framework Preset: **Other** (sem build). Output: a própria pasta.

### Opção C — GitHub Pages
1. Com o site no repositório (ex.: pasta `site/`), vá em **Settings → Pages**.
2. Em *Source*, escolha a branch e a pasta `/site` (ou mova o conteúdo para a raiz / `docs/`).
3. Salve. A URL `https://SEU-USUARIO.github.io/SEU-REPO/` fica disponível em alguns minutos.

> Dica: como os caminhos no HTML são relativos (`css/...`, `js/...`), o site funciona em qualquer subpasta sem ajustes.

---

## 3) Configurar o Lemon Squeezy (checklist)

O Lemon Squeezy é o *Merchant of Record*: cuida do checkout, impostos, e-mail de entrega e **license keys**.

- [ ] **Criar a Store** em <https://app.lemonsqueezy.com> (nome, logo, moeda).
- [ ] **Criar um produto digital** "Orquestrador de Agentes".
- [ ] **Subir o instalador como asset** do produto (o arquivo que o cliente baixa). O Lemon Squeezy gera o link de download seguro e o envia por e-mail.
- [ ] **Ativar License Keys** no produto:
  - Ligue a geração de license key.
  - Defina **máximo de ativações = 1** (uso único por licença; permite desativar/migrar).
- [ ] **Configurar o e-mail de entrega** (template padrão já envia a license key + download). Confira o texto.
- [ ] **Definir o preço** do produto.
- [ ] **Pegar a URL do checkout** (botão *Share* / *Checkout URL* do produto, formato `https://SUA-STORE.lemonsqueezy.com/checkout/buy/XXXX`).
- [ ] **Definir o Redirect após compra** para a sua `sucesso.html` publicada (ex.: `https://seu-site.com/sucesso.html`). Configuração do checkout → *Redirect URL*.
- [ ] (Opcional) Habilitar o **Overlay** do Lemon Squeezy incluindo `lemon.js` no HTML — o `js/app.js` já detecta e abre o checkout em modal se presente.

---

## 4) Placeholders a trocar (IMPORTANTE)

Procure e substitua estes valores antes de publicar:

| Onde | Placeholder | Trocar por |
|------|-------------|-----------|
| `index.html` (vários CTAs) e `sucesso.html` | `https://SEU-STORE.lemonsqueezy.com/checkout/buy/SEU-PRODUTO-ID` | **URL real do checkout** do Lemon Squeezy |
| `index.html` → seção Preço | `R$ XX` (classe `.preco-valor`) | **Valor real** da licença |
| `sucesso.html` → bloco de download | `https://SEU-STORE.lemonsqueezy.com/SEU-LINK-DE-DOWNLOAD` | **Link do asset/download** (ou remova se o download vai só por e-mail) |
| `index.html` e `sucesso.html` → rodapé/contato | `contato@SEU-DOMINIO.com` | **E-mail de contato/suporte** real |
| `index.html` → rodapé | `href="#"` em *Termos* e *Política de privacidade* | **Links das suas páginas** legais |
| `*.html` | Fontes Google (bloco comentado no `<head>` do `index.html`) | Descomente se quiser Poppins/JetBrains Mono (opcional) |

> Como achar rápido: busque por `SEU-`, `XX` e `#` nos HTMLs.

---

## 5) Notas

- O site funciona **com JavaScript desligado** — os botões são links `<a>` normais para o checkout.
- Sem imagens externas: ícones são emojis e SVG inline.
- `sucesso.html` tem `noindex` para não aparecer em buscas.
- Tema e cores espelham o app (`web/src/theme/index.css`): fundo escuro `#141413`, acento laranja `#d97757`.
