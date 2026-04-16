import { Global, Module } from '@nestjs/common';
import { RelationController } from './relation.controller';
import { RelationService } from './relation.service';

@Global()
@Module({
	controllers: [RelationController],
	providers: [RelationService],
	exports: [RelationService]
})
export class RelationModule {}
