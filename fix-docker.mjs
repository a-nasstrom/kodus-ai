import fs from 'fs/promises';

async function fixDockerCompose() {
    const filePath = 'docker-compose.dev.yml';
    let content = await fs.readFile(filePath, 'utf-8');

    // Remover a duplicidade do "environment" unificando as configurações do RabbitMQ.
    // A chave "environment" da linha 205 vai receber os argumentos da linha 228 e a de 228 vai sumir.
    
    const duplicateEnvBlock = `        environment:
            RABBITMQ_DEFAULT_USER: \${RABBITMQ_DEFAULT_USER:-dev}
            RABBITMQ_DEFAULT_PASS: \${RABBITMQ_DEFAULT_PASS:-devpass}
            RABBITMQ_HOSTNAME: \${RABBITMQ_HOSTNAME:-rabbitmq}
            RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '-rabbit heartbeat 60'`;

    // 1. Removemos a duplicata de baixo
    content = content.replace(duplicateEnvBlock, "");

    // 2. Colocamos as variáveis no bloco environment de cima (usando notação de array que já estava lá)
    const newEnvBlock = `        environment:
            - RABBITMQ_DEFAULT_USER=\${RABBITMQ_DEFAULT_USER:-dev}
            - RABBITMQ_DEFAULT_PASS=\${RABBITMQ_DEFAULT_PASS:-devpass}
            - RABBITMQ_HOSTNAME=\${RABBITMQ_HOSTNAME:-rabbitmq}
            - RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=-rabbit disk_free_limit 1000000000 -rabbit heartbeat 60`;

    content = content.replace(/        environment:\n            - RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=-rabbit disk_free_limit 1000000000/, newEnvBlock);

    await fs.writeFile(filePath, content);
    console.log("✅ docker-compose.dev.yml consertado!");
}

fixDockerCompose();
