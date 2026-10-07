# Menu Online

Menu digital para espaços de alimentação em Angola. Marca, favicon, página comercial, demonstração, contas de estabelecimentos, produtos, categorias, preços em Kz, publicação de menus, QR Code e pedidos/reservas pelo WhatsApp.

## Executar

Node.js 24 ou superior.

```sh
npm ci
npm start
```

Abre http://localhost:3000. Demonstração: `/demo`. Gestão: `/painel`.

```sh
npm test
```

Os testes usam uma base de dados isolada e verificam autenticação, isolamento entre contas, validação, publicação, retirada do menu, geração PNG do QR e revogação de sessões.

## Publicar na Hostinger

Aplicação Express com comando de início `npm start`, Node.js **24**, com `npm run build` para validar a sintaxe do servidor. O repositório inclui o ficheiro de dependências bloqueadas.

Variáveis: `NODE_ENV=production`, `PUBLIC_URL=https://menuao.online`, `TRUST_PROXY_HOPS` conforme os proxies da plataforma. O processo respeita `PORT` fornecido pelo alojamento. Se não for fornecido, usa 3000.

`DATA_DIR` tem de apontar para armazenamento persistente fora da pasta substituída nos novos deploys. A base SQLite e os ficheiros WAL ficam nesse diretório. Executa `npm run backup` com a mesma variável DATA_DIR para criar uma cópia consistente em `DATA_DIR/backups`. Agenda uma cópia diária e testa o restauro. Faz backups consistentes com SQLite Backup API; copiar apenas o `.sqlite` enquanto há escritas pode perder dados. Não executar várias instâncias a escrever em discos diferentes. Para escalar horizontalmente, migrar para uma base centralizada.

O modo de piloto permite publicar menus sem subscrição. Os preços, limites comerciais, multiespaços e serviços assistidos apresentados na página são propostas, não funcionalidades de faturação. Não há pagamentos, comissão, stock contabilístico, entrega gerida, emails transacionais, recuperação automática de palavra-passe nem painel de administração global nesta versão.

## Fluxo de pedidos

O cliente escolhe produtos, quantidades, receção e observações. O navegador prepara uma mensagem para `wa.me` com o WhatsApp que o estabelecimento configurou. A mensagem só é enviada quando o cliente a envia no WhatsApp. Pedidos e reservas não são guardados na base de dados nem confirmados automaticamente. O restaurante confirma disponibilidade, taxas, pagamento e reserva na conversa.

## Segurança

Palavras-passe protegidas com scrypt e sal individual; tokens aleatórios, guardados na base apenas como SHA-256; cookies HttpOnly, SameSite e Secure em produção; expiração e revogação de sessões; limitação de tentativas; validação de origem; consultas parametrizadas; autorização por proprietário; escaping da interface e CSP. A configuração de proxy deve refletir a infraestrutura real.

## Antes da abertura comercial

- Identificar entidade operadora, WhatsApp e email de suporte e privacidade.
- Finalizar condições e política de privacidade, contacto do operador e prazos de retenção. Exportação e eliminação autenticada de conta já estão implementadas.
- Implementar recuperação de conta e verificação de email antes de aquisição pública em escala.
- Confirmar armazenamento persistente, backups e restauro depois de um redeploy.
- Implementar subscrições, faturação, limites e gestão interna antes de cobrar os planos.
- Substituir os exemplos por conteúdo autorizado dos estabelecimentos.

## Identidade e imagem

Logotipo vetorial original: `public/logo.svg`. Símbolo e favicon: `public/favicon.svg`. Paleta: verde `#12392d`, lima `#d9f86f`. Tipografia: Manrope e DM Sans, carregadas do Google Fonts, com alternativas de sistema. A fotografia ilustrativa vem de [Unsplash](https://unsplash.com/es/fotos/una-bandeja-con-alitas-de-pollo-patatas-fritas-y-ensalada-de-col-EACDHPSxOt8). As imagens do menu de demonstração são ilustrativas; os nomes e preços são fictícios.
