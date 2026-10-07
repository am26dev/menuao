# Menu Online · Muds

Serviço desenvolvido e gerido pela equipa Muds. Contacto oficial: https://muds.ao/contacto. O contacto pessoal do administrador não é publicado como suporte.

## Aplicação web e API

Node.js 24, Express, SQLite e painéis React. `npm ci`, `npm run build`, `npm start`. Página comercial `/`, exemplo `/demo`, estabelecimento `/painel`, equipa `/gestao`. A página comercial e o menu público preservam a interface leve existente; os painéis de gestão são React.

Planos mensais: Essencial **15 000 Kz / 2 estabelecimentos**, Profissional **25 000 Kz / 5**, Multiespaços **50 000 Kz / 10**. Até 500 produtos por estabelecimento. As assinaturas são controladas manualmente pela Muds: plano, estado, validade e referência de pagamento verificado. Não há débito automático, processamento de pagamentos ou emissão fiscal de faturas.

Um menu e o QR só ficam públicos quando o proprietário solicita publicação, a Muds aprova o estabelecimento e a assinatura está ativa dentro da validade. Alterar nome, WhatsApp ou morada devolve o espaço à revisão. Os limites são aplicados no servidor. Uma redução de plano é bloqueada se o número de espaços ultrapassar o novo limite.

## Equipa e permissões

O primeiro administrador é **Alfredo Muanza, muaza.alfredo@gmail.com**. O perfil inicial **gestor** usa esse identificador de acesso, sem inventar um email. Ambos começam inativos, sem palavra-passe conhecida, e são ativados com convites secretos de utilização única, válidos por 48 horas. O administrador pode criar gestores e administradores, selecionar permissões, bloquear acessos, renovar convites pendentes e consultar auditoria. Permissões: aprovação de espaços, assinaturas, imagens e auditoria. Alterar permissões ou bloquear uma conta revoga as sessões imediatamente.

Autenticação em dois passos TOTP obrigatória para a equipa, antes de aceder à gestão. A configuração inicial apresenta uma chave para adicionar a uma aplicação autenticadora. São entregues oito códigos de recuperação de utilização única. Os segredos TOTP são cifrados com AES-256-GCM; códigos de recuperação e sessões são guardados apenas como SHA-256. Operações administrativas exigem novamente a palavra-passe. Não colocar palavras-passe, convites ou chaves no Git.

## Hostinger

Node.js **24**, build `npm run build`, arranque `npm start`. Usar uma única instância com disco persistente. Variáveis:

- `NODE_ENV=production`, `PUBLIC_URL=https://menuao.online`, `PORT=3000`.
- `DATA_DIR=/home/u812589052/menuao-data`, fora das pastas substituídas pelo deploy.
- `TRUST_PROXY_HOPS=1`, apenas para a cadeia de proxy verificada na Hostinger.
- `MFA_ENCRYPTION_KEY`: 32 bytes aleatórios em hexadecimal, obrigatória em produção. Preservar em gestor de segredos e backups; perder esta chave impede validar os autenticadores existentes. Não substituir sem migração dos segredos.
- `STAFF_ADMIN_ACTIVATION` e `STAFF_MANAGER_ACTIVATION`: convites independentes de 32 bytes aleatórios em hexadecimal, usados apenas no primeiro provisionamento. Depois da ativação podem ser removidos do alojamento.

As migrações preservam IDs, contas e produtos da versão anterior, removem a restrição de um espaço por conta e colocam os menus existentes em revisão com assinatura pendente. Fotografias existentes seguras de até 1 MB são reprocessadas e colocadas em moderação; ficheiros inválidos ou maiores não são servidos. Fazer backup antes de cada migração e testar o restauro.

`npm run backup` utiliza a API de backup SQLite. Incluir também `uploads` e a chave MFA, mantendo os segredos separados dos ficheiros públicos. Agendar backups diários no alojamento. Não copiar apenas o ficheiro SQLite enquanto houver escritas. A base local e os convites nunca são entregues pelo servidor HTTP.

## Imagens

JPG, PNG ou WebP estático, **máximo 1 MB na entrada e na saída**, 16 milhões de píxeis, redimensionamento máximo 2000×2000 e reprocessamento com Sharp, removendo metadados. SVG, conteúdo malformado, múltiplos ficheiros e links externos de produtos são recusados. Limite total de 100 MB por conta. Fotografias pendentes/rejeitadas só são acessíveis ao proprietário ou à equipa com a permissão correspondente; apenas aprovadas aparecem publicamente. A fotografia Unsplash do exemplo comercial é ilustrativa.

## Segurança e validação

`npm test`: autenticação e convites; MFA conforme vetores RFC 6238; cifragem autenticada e adulteração; autorização por conta e permissão; revogação de sessões; planos e publicação; moderação; ficheiros falsos e acima do limite; CSRF; consultas parametrizadas; tentativas de injeção; caminhos privados; limitação de tentativas; QR decodificado independentemente; exportação, eliminação e migração de dados.

Palavras-passe com scrypt assíncrono e sal aleatório. Cookies HttpOnly, Secure em produção e SameSite Strict, sessão de proprietário até 24h e da equipa até 1h. Novo login revoga a sessão anterior. API móvel utiliza tokens opacos revogáveis, guardados no Keychain/Keystore através de SecureStore, sem guardar a palavra-passe. Origin e Fetch Metadata protegem operações web. Helmet aplica CSP sem scripts inline, proteção contra enquadramento, HSTS em produção e outros cabeçalhos. Limites de corpo, imagens, pedidos e confirmações reduzem abuso. SQL parametrizado e validação são aplicados no servidor.

Isto não garante imunidade a ataques. Os testes são controlados, não incluem ataques destrutivos à infraestrutura, DDoS distribuído ou uma auditoria externa completa. Monitorização do alojamento, atualização contínua, backups restauráveis e revisão independente continuam necessários. Verificar email e recuperação automatizada de palavra-passe são trabalho futuro; o suporte deve verificar a identidade antes de qualquer recuperação manual.

## Aplicação Android e iOS

Projeto **React Native / Expo SDK 57** em `mobile/`, com versões correspondentes ao SDK. `cd mobile`, `npm ci`, `npm start`. `npm run export` valida os bundles Android/iOS. `eas build --profile preview --platform android` gera APK com conta Expo configurada; `eas build --profile production --platform all` prepara distribuição. Assinatura e publicação exigem as contas de programador da Muds e testes em dispositivos reais.

Inclui menu, pesquisa, carrinho, reservas, QR com câmara, acesso seguro, múltiplos espaços, produtos e fotografias, aprovação de espaços e moderação de imagens. Assinaturas, convites, permissões e auditoria completos continuam no painel web. A configuração inicial MFA da equipa é feita no site. Apenas QR de `https://menuao.online/m/...` são aceites. Pedidos e reservas abrem o WhatsApp para o cliente rever e enviar; o restaurante confirma.

**Distribuição móvel pendente:** o audit do SDK detetou avisos transitivos nas ferramentas de compilação (braces, node-forge e uuid, entre outros efeitos propagados). Não retroceder para Expo 44 nem usar `audit fix --force`: isso destrói a compatibilidade. A aplicação não deve ser considerada pronta para lançamento nas lojas até resolver/avaliar estes avisos e testar num dispositivo real. Os módulos móveis não são instalados no servidor web.

## Conteúdo e termos

Pedidos/reservas não são guardados na base; são preparados no dispositivo e enviados pelo cliente no WhatsApp. O restaurante responde por preços, disponibilidade, ingredientes, alergénios, entrega e pagamento. As condições comerciais e retenção de auditoria/backups devem ser formalizadas pela Muds antes da venda em escala. Exportação e eliminação autenticadas estão disponíveis ao proprietário.
