import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { SyrProxyController } from './syr-proxy.controller';

@Module({
	controllers: [ProxyController, SyrProxyController]
})
export class ProxyModule {}
