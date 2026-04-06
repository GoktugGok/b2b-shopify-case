import fs from 'fs';
import path from 'path';

// If running in Vercel or similar environment where the CA cert is passed as an env variable
const caCertContent = process.env.AIVEN_CA_CERT;

if (caCertContent) {
  // Replace actual literal \n with real newlines just in case
  const formattedCert = caCertContent.replace(/\\n/g, '\n');
  const destPath = path.join(process.cwd(), 'prisma', 'aiven-ca.pem');
  
  fs.writeFileSync(destPath, formattedCert);
  console.log('✅ Aiven CA certificate successfully created from environment variable AIVEN_CA_CERT');
} else {
  console.log('ℹ️ AIVEN_CA_CERT environment variable not found. Using existing local file if necessary.');
}
