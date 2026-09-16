import { Module } from '@nestjs/common';
import { StationeryController } from './stationery.controller';
import { StationeryOperationsController } from './stationery-operations.controller';
import { StationeryService } from './stationery.service';
import { StationeryOperationsService } from './stationery-operations.service';

@Module({
  controllers: [StationeryController, StationeryOperationsController],
  providers: [StationeryService, StationeryOperationsService],
  exports: [StationeryService, StationeryOperationsService],
})
export class StationeryModule {}
