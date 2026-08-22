import mongoose from 'mongoose';
import { planService } from './src/services/planService';

async function main() {
  await mongoose.connect('mongodb://localhost:27017/pos');
  try {
    const result = await planService.list({ page: 1, limit: 50 });
    console.log('SUCCESS total:', result.total);
    console.log(JSON.stringify(result.data, null, 2));
  } catch (e) {
    console.error('LIST ERROR:', e);
  }
  await mongoose.disconnect();
}

main();
