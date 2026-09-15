import { Module } from '@nestjs/common';
import { StationeryController } from './stationery.controller';
import { StationeryService } from './stationery.service';

@Module({
  controllers: [StationeryController],
  providers: [StationeryService],
  exports: [StationeryService],
})
export class StationeryModule {}
