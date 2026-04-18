import { Client } from "langsmith";
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const client = new Client({ apiKey: process.env.LANGCHAIN_API_KEY });

async function main() {
    const targetPr = 88;
    console.log(`🕵️‍♂️  DEEP TRACE ANALYSIS: PR #${targetPr}`);
    const orgId = "c19cca98-e359-4ad2-b2ab-2cfc3a6bb863";
    const projectName = process.env.LANGCHAIN_PROJECT || "default";

    const rootRuns = [];
    for await (const run of client.listRuns({
        projectName,
        executionOrder: 1, limit: 100
    })) {
        if (run.extra?.metadata?.prNumber === targetPr || run.extra?.metadata?.pullRequestId === targetPr) {
            rootRuns.push(run);
        }
    }

    const agentsToAnalyze = rootRuns.filter(r => r.name.includes("review-agent"));

    for (const run of agentsToAnalyze) {
        console.log(`\n==================================================`);
        console.log(`🤖 AGENT: ${run.name}`);
        console.log(`==================================================`);

        const childRuns = [];
        for await (const child of client.listRuns({ traceId: run.trace_id })) {
            if (child.id !== run.id) childRuns.push(child);
        }
        childRuns.sort((a, b) => a.start_time - b.start_time);

        let step = 1;
        for (let i = 0; i < childRuns.length; i++) {
            const child = childRuns[i];
            
            if (child.run_type === "llm") {
                const outputs = child.outputs;
                let text = '';
                if (outputs?.generations?.[0]?.[0]) {
                    text = outputs.generations[0][0].text || outputs.generations[0][0].message?.content || '';
                } else if (outputs?.output) {
                    text = typeof outputs.output === 'string' ? outputs.output : JSON.stringify(outputs.output);
                }
                
                if (text) {
                    console.log(`\n🧠 [TURN ${step} - THINKING]`);
                    console.log(`   "${text.replace(/\n/g, ' ').substring(0, 300)}..."`);
                }
                step++;
            } 
            else if (child.run_type === "tool") {
                console.log(`\n🛠️  [TURN ${step} - ACTION] Called ${child.name}`);
                console.log(`   Input:  ${JSON.stringify(child.inputs.args || child.inputs)}`);
                
                const outStr = JSON.stringify(child.outputs || {});
                const truncated = outStr.length > 500 ? outStr.substring(0, 500) + `... [${Math.round(outStr.length/1024)}KB]` : outStr;
                console.log(`   Result: ${truncated.replace(/\n/g, '\\n')}`);
            }
        }
    }
}
main();
