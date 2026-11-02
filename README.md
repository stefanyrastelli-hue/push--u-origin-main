# PDI · Escavador

App de **Plano de Desenvolvimento Individual** em Google Apps Script sobre uma planilha Google, no visual do portal Smart.

- **Liderado:** monta o PDI (Identificação, Autoavaliação, Objetivo de Carreira, Plano de Ação), define prazos, envia ao líder e atualiza o andamento.
- **Líder:** acompanha o time e aprova ou reprova cada plano de ação. Reprovar exige observação do que precisa ter.
- **RH:** visão geral de quem tem e quem não tem PDI, conclusão, situação por área, atrasos e origem (ferramenta ou Excel). Também mantém o cadastro de colaboradores.
- **Excel:** importa o modelo `modelos/PDI.xlsx` preenchido e exporta o PDI no mesmo layout.

**Demonstração:** abra `docs/index.html` no navegador. Fora do Apps Script, o app entra em modo demonstração, com dados de exemplo e um seletor "Ver como". Com o GitHub Pages ativado na pasta `/docs`, a demonstração fica online.

## Estrutura
```
src/                  arquivos que vão para o Apps Script (gerados, não edite à mão)
  Codigo.gs           servidor: doGet, menu PDI, configurar(), endpoint api()
  Logica.gs           regras de negócio (status, aprovação, permissões, painel RH, importação)
  Index.html          interface (inclui o modo demonstração)
  appsscript.json     manifesto (V8, web app: executar como quem implantou, acesso ao domínio)
dev/                  fontes editáveis
  Index.src.html      interface (o marcador /*@@LOGICA@@*/ recebe dev/Logica.js no build)
  Logica.js           regras (a mesma cópia vai para src/Logica.gs e para a demonstração)
  Codigo.gs           servidor
  build.py            gera src/ e docs/
docs/index.html       demonstração estática
modelos/PDI.xlsx      modelo de Excel que o app importa
```

## Fluxo de desenvolvimento
1. Edite os arquivos em `dev/`.
2. Rode o build:
   ```bash
   python3 dev/build.py
   ```
3. Publique no Apps Script de uma das duas formas abaixo.

### Opção A: colar no editor
Crie uma planilha Google e abra **Extensões → Apps Script**. Crie `Codigo.gs`, `Logica.gs` e `Index.html` com o conteúdo de `src/`. Em **Configurações do projeto**, marque "Mostrar appsscript.json" e cole o manifesto.

### Opção B: clasp
```bash
npm i -g @google/clasp
```
```bash
clasp login
```
```bash
cp .clasp.json.example .clasp.json
```
Coloque o ID do script (Configurações do projeto → ID do script) em `.clasp.json`. Depois:
```bash
clasp push
```

## Primeira configuração
1. Na planilha, use o menu **PDI → Configurar planilha (1ª vez)**. Ele cria as abas `Colaboradores`, `PDIs`, `Autoavaliação`, `Plano de Ação` e `Histórico`, e cadastra você como RH.
2. **Implantar → Nova implantação → App da Web**, com "Executar como: Eu" e "Quem pode acessar: qualquer pessoa no domínio".
3. No app, abra **Colaboradores** e importe a lista com Nome, E-mail, Cargo, Área, **Gestor (e-mail)** e Perfil. O gestor de cada pessoa é quem aprova o PDI dela.
4. Para atualizar: Gerenciar implantações → Editar → **Nova versão**. Depois recarregue com Ctrl+Shift+R e confira o selo BUILD no topo.

O login é pela conta Google do domínio: o app identifica a pessoa com `Session.getActiveUser()`.

## Regras principais
- Ações nascem como **rascunho** e vão para **aguardando líder** quando o liderado envia para aprovação.
- Se o liderado mudar o conteúdo de uma ação **aprovada**, ela volta para aprovação. Se ajustar uma **reprovada**, ela volta para rascunho.
- Status do PDI: Sem PDI · Em elaboração · Aguardando aprovação · Ajustes solicitados · Em andamento · Concluído.
- Na importação do Excel, linhas que começam com "Ex:" são ignoradas. Prazo em texto, como "3 meses", vira data contada a partir do início.
