import { Module, Global } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { VoiceModule } from '../voice/voice.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
	imports: [AuthModule, VoiceModule],
	providers: [ChatGateway],
	exports: [ChatGateway]
})
export class GatewayModule {}
