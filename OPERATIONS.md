# Operação e recuperação do MenuAO

Uma única instância Node.js 24 com disco persistente. Não duplicar instâncias com bases SQLite independentes. `DATA_DIR` deve ficar fora da pasta substituída pelo deploy; na instalação atual aponta para `/home/u812589052/menuao-data`.

## Cópias completas

`npm run backup` cria uma pasta `snapshot-*` com SQLite consistente, todas as imagens referenciadas em `media`, comprovativos referenciados em `payment_proofs` e um manifesto SHA-256. Verifica integridade SQLite, referências e ficheiros antes de marcar sucesso. Uma cópia incompleta permanece identificada como `.incomplete-*` e não deve ser restaurada. A origem não é alterada. Uma eliminação simultânea de um ficheiro pode fazer falhar a cópia, que deve ser repetida; não se bloqueiam as escritas de clientes durante a cópia.

Em produção, um processo separado tenta criar uma cópia após o arranque e verifica de hora a hora se passaram 24 horas desde a última cópia bem-sucedida. A tarefa depende de a aplicação estar em execução. A cópia é recusada se não houver espaço estimado com margem de segurança de 512 MB. Os registos de execução indicam sucesso ou falha; Gestão → Equipa e acessos mostra o estado. Isto não substitui alertas externos de disponibilidade.

Conservar uma cópia fora deste alojamento, num destino privado controlado pela MUDS, e a chave `MFA_ENCRYPTION_KEY` num gestor de segredos separado. A chave não é incluída no manifesto nem em ficheiros públicos. Perder a chave impede recuperar MFA e configurações de email cifradas. Não enviar snapshots, chaves ou comprovativos para GitHub. A política de rotação deve ser aprovada e aplicada no destino; não é feita eliminação automática das cópias por este código.

## Ensaio de restauro

`npm run restore:check -- /caminho/snapshot /novo/diretorio-isolado` verifica hashes, copia os dados para um destino novo e testa integridade e contagens. Recusa um destino existente, a pasta de produção e os seus descendentes. Nunca apontar o servidor público ao ensaio. O teste automatizado demonstra restauro de contas, menus, produtos, imagens e comprovativos com dados sintéticos e recusa corrupção.

Um restauro real exige uma janela de manutenção: parar escritas, preservar a instalação atual, verificar snapshot e chave, restaurar para uma nova pasta privada, reaplicar eliminações feitas após a cópia, revogar sessões/convites/links de recuperação antigos, testar acessos e conteúdos num ambiente isolado e só depois mudar o serviço. Não restaurar por cima de uma base em utilização nem copiar apenas `menu.sqlite` sem o WAL.

## Verificação e incidentes

`npm test`, `npm run build`, `npm run test:capacity` e `npm run test:stress` utilizam dados locais descartáveis. O ensaio de capacidade tem 1.000 estabelecimentos e 20.000 produtos; não certifica capacidade Hostinger nem resistência DDoS. Confirmar recursos reais, disco e acessos durante crescimento gradual. Uma conta pode usar até 100 MB de imagens e mais 100 MB de comprovativos; mil contas podem exceder o disco do plano atual, antes das cópias.

O workflow `security.yml` executa auditoria das dependências, testes e build em cada alteração e semanalmente. A implementação Hostinger continua independente desses checks; a equipa deve verificar os checks antes de lançar alterações. Falhas de autenticação em volume, erros 5xx, disco baixo, fila de email bloqueada e backup com mais de 26 horas requerem investigação. A API de operações é restrita ao administrador com MFA; o health público só devolve disponibilidade básica.

SMTP configurado não comprova entrega na caixa do destinatário. Antes do lançamento, verificar envio e receção com uma conta real controlada pela MUDS, SPF/DKIM/DMARC e pasta de spam. As contas Hostinger e GitHub devem ter MFA, recuperação segura e acessos mínimos. Estas configurações de conta não são alteradas sem o titular.

Confirmar proteção CDN/anti-DDoS na Hostinger e acompanhar eventos. Não simular DDoS contra produção. Uma auditoria independente e testes de carga no ambiente equivalente ao alojamento continuam necessários para obter uma avaliação externa de lançamento.
