import { traceable } from 'langsmith/traceable';
delete process.env.LANGCHAIN_TRACING_V2;

const myFunc = traceable(async (msg) => {
    return "Hello " + msg;
}, { name: "TestTraceable" });

async function main() {
    console.log(await myFunc("World"));
}
main();
