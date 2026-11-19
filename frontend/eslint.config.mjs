import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
const config = [...nextVitals, ...nextTypescript, { files: ["components/Workspace.tsx"], rules: { "react-hooks/refs": "off" } }];
export default config;
