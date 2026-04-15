import { Module } from '@nestjs/common';
import { MemberController } from './member.controller';
import { MemberService } from './member.service';
import { MessageModule } from '../message/message.module';

@Module({
	imports: [MessageModule],
	controllers: [MemberController],
	providers: [MemberService],
	exports: [MemberService]
})
export class MemberModule {}
