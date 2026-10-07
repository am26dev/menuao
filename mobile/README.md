# Menu Online — aplicação móvel

Projeto React Native com Expo SDK 57 para Android e iOS.

## Executar

Instalar Node.js, abrir esta pasta e executar `npm ci` e `npx expo start`. A API publicada é https://menuao.online.

As exportações Android e iOS foram compiladas com sucesso. Esta entrega contém o código-fonte; não inclui APK nem publicação nas lojas, conforme solicitado.

## Segurança e distribuição

A sessão é guardada em SecureStore. As contas da equipa exigem autenticação de dois fatores; a configuração inicial realiza-se na gestão web. Não guardar palavras-passe no código.

A auditoria das dependências móveis identificou 22 avisos (15 elevados e 7 moderados), sobretudo em ferramentas transitivas do Expo. É necessária revisão e atualização antes da distribuição pública. Não executar atualização forçada que altere a versão principal do Expo sem validar a compatibilidade.

Consultar o relatório de segurança da entrega para os testes realizados e limitações.
